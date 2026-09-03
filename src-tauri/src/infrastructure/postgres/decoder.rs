use base64::Engine;
use sqlx::postgres::types::{PgInterval, PgMoney, PgRange, PgTimeTz};
use sqlx::postgres::{PgColumn, PgRow, PgTypeInfo, PgTypeKind};
use sqlx::{Column, Row, TypeInfo, ValueRef};

use crate::domain::db_value::{ArrayDimension, DbValue, JsonType, TemporalType};
use crate::domain::events::{ColumnCategory, ColumnMeta, ColumnSource};

use super::large_values::{LargeValueStore, INLINE_BINARY_LIMIT};

fn category_of(ti: &PgTypeInfo) -> ColumnCategory {
    match ti.kind() {
        PgTypeKind::Array(_) => return ColumnCategory::Array,
        PgTypeKind::Enum(_) => return ColumnCategory::Enum,
        PgTypeKind::Range(_) => return ColumnCategory::Range,
        PgTypeKind::Composite(_) => return ColumnCategory::Composite,
        PgTypeKind::Domain(base) => return category_of(base),
        _ => {}
    }
    match ti.name() {
        "BOOL" => ColumnCategory::Boolean,
        "INT2" | "INT4" | "INT8" | "OID" => ColumnCategory::Integer,
        "NUMERIC" | "MONEY" => ColumnCategory::Decimal,
        "FLOAT4" | "FLOAT8" => ColumnCategory::Float,
        "TEXT" | "VARCHAR" | "BPCHAR" | "CHAR" | "NAME" | "XML" | "CITEXT" => ColumnCategory::Text,
        "BYTEA" => ColumnCategory::Binary,
        "UUID" => ColumnCategory::Uuid,
        "DATE" | "TIME" | "TIMETZ" | "TIMESTAMP" | "TIMESTAMPTZ" | "INTERVAL" => {
            ColumnCategory::Temporal
        }
        "JSON" | "JSONB" => ColumnCategory::Json,
        "INET" | "CIDR" | "MACADDR" | "MACADDR8" => ColumnCategory::Network,
        _ => ColumnCategory::Unknown,
    }
}

pub fn column_meta(columns: &[PgColumn]) -> Vec<ColumnMeta> {
    columns
        .iter()
        .map(|c| ColumnMeta {
            index: c.ordinal() as u32,
            name: c.name().to_string(),
            pg_type_oid: c.type_info().oid().map(|o| o.0).unwrap_or(0),
            pg_type_name: c.type_info().name().to_string(),
            category: category_of(c.type_info()),
            source: match (c.relation_id(), c.relation_attribute_no()) {
                (Some(rel), Some(att)) => Some(ColumnSource {
                    relation_oid: rel.0,
                    attribute_number: att,
                }),
                _ => None,
            },
            nullable: None, // result metadata alone cannot prove this; never guess false
            editable: false, // editability detection lands in Milestone C
        })
        .collect()
}

pub fn decode_row(row: &PgRow, large: &LargeValueStore) -> Vec<DbValue> {
    (0..row.len()).map(|i| decode_cell(row, i, large)).collect()
}

fn fmt_f64(v: f64) -> String {
    if v.is_nan() {
        "NaN".into()
    } else if v == f64::INFINITY {
        "Infinity".into()
    } else if v == f64::NEG_INFINITY {
        "-Infinity".into()
    } else {
        format!("{v}")
    }
}

fn fmt_f32(v: f32) -> String {
    if v.is_nan() {
        "NaN".into()
    } else if v.is_infinite() {
        if v > 0.0 { "Infinity".into() } else { "-Infinity".into() }
    } else {
        format!("{v}")
    }
}

fn fmt_interval(i: &PgInterval) -> String {
    let mut parts: Vec<String> = Vec::new();
    let years = i.months / 12;
    let mons = i.months % 12;
    if years != 0 {
        parts.push(format!("{years} year{}", if years.abs() == 1 { "" } else { "s" }));
    }
    if mons != 0 {
        parts.push(format!("{mons} mon{}", if mons.abs() == 1 { "" } else { "s" }));
    }
    if i.days != 0 {
        parts.push(format!("{} day{}", i.days, if i.days.abs() == 1 { "" } else { "s" }));
    }
    if i.microseconds != 0 || parts.is_empty() {
        let neg = i.microseconds < 0;
        let us = i.microseconds.unsigned_abs();
        let (h, m, s, frac) = (us / 3_600_000_000, us / 60_000_000 % 60, us / 1_000_000 % 60, us % 1_000_000);
        let mut t = format!("{}{:02}:{:02}:{:02}", if neg { "-" } else { "" }, h, m, s);
        if frac != 0 {
            t.push_str(format!(".{frac:06}").trim_end_matches('0'));
        }
        parts.push(t);
    }
    parts.join(" ")
}

/// Parses the PostgreSQL binary NUMERIC wire format so the declared scale
/// (dscale) survives — sqlx's BigDecimal conversion pads to base-10000 groups.
fn decode_numeric_raw(bytes: &[u8]) -> Option<String> {
    if bytes.len() < 8 {
        return None;
    }
    let ndigits = i16::from_be_bytes([bytes[0], bytes[1]]) as usize;
    let weight = i16::from_be_bytes([bytes[2], bytes[3]]) as i32;
    let sign = u16::from_be_bytes([bytes[4], bytes[5]]);
    let dscale = u16::from_be_bytes([bytes[6], bytes[7]]) as usize;
    if bytes.len() < 8 + ndigits * 2 {
        return None;
    }
    match sign {
        0xC000 => return Some("NaN".into()),
        0xD000 => return Some("Infinity".into()),
        0xF000 => return Some("-Infinity".into()),
        0x0000 | 0x4000 => {}
        _ => return None,
    }
    let digits: Vec<u16> = (0..ndigits)
        .map(|i| u16::from_be_bytes([bytes[8 + i * 2], bytes[9 + i * 2]]))
        .collect();

    let mut int_part = String::new();
    if weight >= 0 {
        for gi in 0..=(weight as usize) {
            let d = digits.get(gi).copied().unwrap_or(0);
            if int_part.is_empty() {
                int_part = d.to_string();
            } else {
                int_part.push_str(&format!("{d:04}"));
            }
        }
    }
    if int_part.is_empty() {
        int_part = "0".into();
    }

    let mut frac = String::new();
    if dscale > 0 {
        let mut gi = (weight + 1).max(0) as usize;
        // groups between the integer part and the first stored fractional group are zeros
        let mut leading_zero_groups = (-(weight + 1)).max(0) as usize;
        while frac.len() < dscale {
            if leading_zero_groups > 0 {
                frac.push_str("0000");
                leading_zero_groups -= 1;
            } else {
                let d = digits.get(gi).copied().unwrap_or(0);
                frac.push_str(&format!("{d:04}"));
                gi += 1;
            }
        }
        frac.truncate(dscale);
    }

    let sign_str = if sign == 0x4000 { "-" } else { "" };
    Some(if frac.is_empty() {
        format!("{sign_str}{int_part}")
    } else {
        format!("{sign_str}{int_part}.{frac}")
    })
}

fn fmt_range<T: std::fmt::Display>(r: PgRange<T>) -> String {
    use std::ops::Bound;
    let mut out = String::new();
    match &r.start {
        Bound::Included(v) => out.push_str(&format!("[{v}")),
        Bound::Excluded(v) => out.push_str(&format!("({v}")),
        Bound::Unbounded => out.push('('),
    }
    out.push(',');
    match &r.end {
        Bound::Included(v) => out.push_str(&format!("{v}]")),
        Bound::Excluded(v) => out.push_str(&format!("{v})")),
        Bound::Unbounded => out.push(')'),
    }
    out
}

fn array_of<T>(values: Vec<Option<T>>, elem_oid: u32, f: impl Fn(T) -> DbValue) -> DbValue {
    // ponytail: sqlx flattens to 1-D with default lower bound; raw multidim
    // array decoding is deferred (unsupported shapes fall back to unknown).
    let dims = vec![ArrayDimension {
        lower_bound: 1,
        length: values.len() as u32,
    }];
    DbValue::Array {
        dimensions: dims,
        values: values
            .into_iter()
            .map(|v| v.map(&f).unwrap_or(DbValue::Null))
            .collect(),
        element_type_oid: elem_oid,
    }
}

fn decode_array(row: &PgRow, i: usize, elem: &PgTypeInfo) -> Option<DbValue> {
    let oid = elem.oid().map(|o| o.0).unwrap_or(0);
    match elem.name() {
        "BOOL" => row
            .try_get::<Vec<Option<bool>>, _>(i)
            .ok()
            .map(|v| array_of(v, oid, |b| DbValue::Boolean { value: b })),
        "INT2" => row
            .try_get::<Vec<Option<i16>>, _>(i)
            .ok()
            .map(|v| array_of(v, oid, DbValue::integer)),
        "INT4" => row
            .try_get::<Vec<Option<i32>>, _>(i)
            .ok()
            .map(|v| array_of(v, oid, DbValue::integer)),
        "INT8" => row
            .try_get::<Vec<Option<i64>>, _>(i)
            .ok()
            .map(|v| array_of(v, oid, DbValue::integer)),
        "FLOAT4" => row
            .try_get::<Vec<Option<f32>>, _>(i)
            .ok()
            .map(|v| array_of(v, oid, |x| DbValue::Float { value: fmt_f32(x) })),
        "FLOAT8" => row
            .try_get::<Vec<Option<f64>>, _>(i)
            .ok()
            .map(|v| array_of(v, oid, |x| DbValue::Float { value: fmt_f64(x) })),
        "NUMERIC" => row
            .try_get::<Vec<Option<sqlx::types::BigDecimal>>, _>(i)
            .ok()
            .map(|v| array_of(v, oid, |x| DbValue::Decimal { value: x.to_string() })),
        "TEXT" | "VARCHAR" | "BPCHAR" | "CHAR" | "NAME" => row
            .try_get::<Vec<Option<String>>, _>(i)
            .ok()
            .map(|v| array_of(v, oid, DbValue::text)),
        "UUID" => row
            .try_get::<Vec<Option<sqlx::types::Uuid>>, _>(i)
            .ok()
            .map(|v| array_of(v, oid, |u| DbValue::Uuid { value: u.to_string() })),
        _ => None,
    }
}

fn unknown_fallback(row: &PgRow, i: usize, ti: &PgTypeInfo) -> DbValue {
    let oid = ti.oid().map(|o| o.0).unwrap_or(0);
    // Try a lossless text representation before giving up.
    let value = row
        .try_get_raw(i)
        .ok()
        .and_then(|raw| raw.as_str().ok().map(str::to_owned))
        .unwrap_or_else(|| format!("<{}>", ti.name().to_lowercase()));
    DbValue::Unknown {
        value,
        type_oid: oid,
        type_name: ti.name().to_string(),
    }
}

fn decode_cell(row: &PgRow, i: usize, large: &LargeValueStore) -> DbValue {
    let raw = match row.try_get_raw(i) {
        Ok(raw) => raw,
        Err(_) => {
            return DbValue::Unknown {
                value: "<unreadable>".into(),
                type_oid: 0,
                type_name: String::new(),
            }
        }
    };
    if raw.is_null() {
        return DbValue::Null;
    }
    let ti = raw.type_info().into_owned();
    decode_typed(row, i, &ti, large)
}

fn decode_typed(row: &PgRow, i: usize, ti: &PgTypeInfo, large: &LargeValueStore) -> DbValue {
    // structural kinds first
    match ti.kind() {
        PgTypeKind::Array(elem) => {
            let elem = elem.clone();
            return decode_array(row, i, &elem).unwrap_or_else(|| unknown_fallback(row, i, ti));
        }
        PgTypeKind::Enum(_) => {
            let value = row
                .try_get_raw(i)
                .ok()
                .and_then(|r| r.as_str().ok().map(str::to_owned))
                .unwrap_or_default();
            return DbValue::Enum {
                value,
                type_name: ti.name().to_string(),
            };
        }
        PgTypeKind::Composite(_) => {
            return DbValue::Composite {
                value: format!("<{}>", ti.name().to_lowercase()),
                type_name: ti.name().to_string(),
            };
        }
        PgTypeKind::Domain(base) => {
            let base = base.clone();
            return decode_typed(row, i, &base, large);
        }
        _ => {}
    }

    let name = ti.name();
    let decoded = match name {
        "BOOL" => row.try_get::<bool, _>(i).map(|v| DbValue::Boolean { value: v }).ok(),
        "INT2" => row.try_get::<i16, _>(i).map(DbValue::integer).ok(),
        "INT4" => row.try_get::<i32, _>(i).map(DbValue::integer).ok(),
        "INT8" => row.try_get::<i64, _>(i).map(DbValue::integer).ok(),
        "OID" => row
            .try_get::<sqlx::postgres::types::Oid, _>(i)
            .map(|v| DbValue::integer(v.0))
            .ok(),
        "NUMERIC" => row
            .try_get_raw(i)
            .ok()
            .and_then(|r| r.as_bytes().ok().and_then(decode_numeric_raw))
            .map(|value| DbValue::Decimal { value })
            .or_else(|| {
                row.try_get::<sqlx::types::BigDecimal, _>(i)
                    .map(|v| DbValue::Decimal { value: v.to_string() })
                    .ok()
            }),
        "MONEY" => row
            .try_get::<PgMoney, _>(i)
            .map(|v| DbValue::Decimal {
                value: v.to_bigdecimal(2).to_string(),
            })
            .ok(),
        "FLOAT4" => row
            .try_get::<f32, _>(i)
            .map(|v| DbValue::Float { value: fmt_f32(v) })
            .ok(),
        "FLOAT8" => row
            .try_get::<f64, _>(i)
            .map(|v| DbValue::Float { value: fmt_f64(v) })
            .ok(),
        "TEXT" | "VARCHAR" | "BPCHAR" | "CHAR" | "NAME" | "XML" | "CITEXT" | "UNKNOWN" => row
            .try_get_raw(i)
            .ok()
            .and_then(|r| r.as_str().ok().map(str::to_owned))
            .map(DbValue::text),
        "UUID" => row
            .try_get::<sqlx::types::Uuid, _>(i)
            .map(|v| DbValue::Uuid { value: v.to_string() })
            .ok(),
        "DATE" => row
            .try_get::<chrono::NaiveDate, _>(i)
            .map(|v| DbValue::Temporal {
                temporal_type: TemporalType::Date,
                value: v.format("%Y-%m-%d").to_string(),
            })
            .ok(),
        "TIME" => row
            .try_get::<chrono::NaiveTime, _>(i)
            .map(|v| DbValue::Temporal {
                temporal_type: TemporalType::Time,
                value: v.format("%H:%M:%S%.f").to_string(),
            })
            .ok(),
        "TIMETZ" => row
            .try_get::<PgTimeTz, _>(i)
            .map(|v| DbValue::Temporal {
                temporal_type: TemporalType::Timetz,
                value: format!("{}{}", v.time.format("%H:%M:%S%.f"), v.offset),
            })
            .ok(),
        "TIMESTAMP" => row
            .try_get::<chrono::NaiveDateTime, _>(i)
            .map(|v| DbValue::Temporal {
                temporal_type: TemporalType::Timestamp,
                value: v.format("%Y-%m-%dT%H:%M:%S%.f").to_string(),
            })
            .ok(),
        "TIMESTAMPTZ" => row
            .try_get::<chrono::DateTime<chrono::Utc>, _>(i)
            .map(|v| DbValue::Temporal {
                temporal_type: TemporalType::Timestamptz,
                value: v.to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true),
            })
            .ok(),
        "INTERVAL" => row
            .try_get::<PgInterval, _>(i)
            .map(|v| DbValue::Temporal {
                temporal_type: TemporalType::Interval,
                value: fmt_interval(&v),
            })
            .ok(),
        "JSON" | "JSONB" => row
            .try_get::<sqlx::types::Json<Box<serde_json::value::RawValue>>, _>(i)
            .map(|v| DbValue::Json {
                value: v.0.get().to_string(),
                json_type: if name == "JSONB" { JsonType::Jsonb } else { JsonType::Json },
            })
            .ok(),
        "BYTEA" => row
            .try_get::<Vec<u8>, _>(i)
            .map(|bytes| {
                let byte_length = bytes.len() as u64;
                if bytes.len() <= INLINE_BINARY_LIMIT {
                    DbValue::Binary {
                        encoding: "base64".into(),
                        value: Some(base64::engine::general_purpose::STANDARD.encode(&bytes)),
                        byte_length,
                        truncated: false,
                        value_handle: None,
                    }
                } else {
                    DbValue::Binary {
                        encoding: "base64".into(),
                        value: None,
                        byte_length,
                        truncated: true,
                        value_handle: Some(large.insert(bytes)),
                    }
                }
            })
            .ok(),
        "INET" | "CIDR" => row
            .try_get::<sqlx::types::ipnetwork::IpNetwork, _>(i)
            .map(|v| DbValue::Network {
                value: v.to_string(),
                network_type: name.to_lowercase(),
            })
            .ok(),
        "MACADDR" => row
            .try_get::<sqlx::types::mac_address::MacAddress, _>(i)
            .map(|v| DbValue::Network {
                value: v.to_string(),
                network_type: "macaddr".into(),
            })
            .ok(),
        "INT4RANGE" => row.try_get::<PgRange<i32>, _>(i).map(|r| range_value(r, name)).ok(),
        "INT8RANGE" => row.try_get::<PgRange<i64>, _>(i).map(|r| range_value(r, name)).ok(),
        "NUMRANGE" => row
            .try_get::<PgRange<sqlx::types::BigDecimal>, _>(i)
            .map(|r| range_value(r, name))
            .ok(),
        "DATERANGE" => row
            .try_get::<PgRange<chrono::NaiveDate>, _>(i)
            .map(|r| range_value(r, name))
            .ok(),
        "TSRANGE" => row
            .try_get::<PgRange<chrono::NaiveDateTime>, _>(i)
            .map(|r| range_value(r, name))
            .ok(),
        "TSTZRANGE" => row
            .try_get::<PgRange<chrono::DateTime<chrono::Utc>>, _>(i)
            .map(|r| range_value(r, name))
            .ok(),
        _ => None,
    };
    decoded.unwrap_or_else(|| unknown_fallback(row, i, ti))
}

fn range_value<T: std::fmt::Display>(r: PgRange<T>, type_name: &str) -> DbValue {
    DbValue::Range {
        value: fmt_range(r),
        range_type: type_name.to_lowercase(),
    }
}
