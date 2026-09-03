use sqlx::postgres::{PgColumn, PgRow};
use sqlx::{Column, Row, TypeInfo, ValueRef};

use crate::domain::events::ColumnMeta;
use crate::domain::DbValue;

pub fn column_meta(columns: &[PgColumn]) -> Vec<ColumnMeta> {
    columns
        .iter()
        .map(|c| ColumnMeta {
            index: c.ordinal() as u32,
            name: c.name().to_string(),
            type_oid: c.type_info().oid().map(|o| o.0).unwrap_or(0),
            type_name: c.type_info().name().to_string(),
        })
        .collect()
}

pub fn decode_row(row: &PgRow) -> Vec<DbValue> {
    (0..row.len()).map(|i| decode_cell(row, i)).collect()
}

fn decode_cell(row: &PgRow, i: usize) -> DbValue {
    let type_name = match row.try_get_raw(i) {
        Ok(raw) => {
            if raw.is_null() {
                return DbValue::Null;
            }
            raw.type_info().name().to_string()
        }
        Err(_) => return DbValue::Fallback("<unreadable>".into()),
    };

    // Milestone A coverage; everything else -> typed Fallback placeholder.
    let decoded = match type_name.as_str() {
        "BOOL" => row.try_get::<bool, _>(i).map(DbValue::Bool).ok(),
        "INT2" => row
            .try_get::<i16, _>(i)
            .map(|v| DbValue::Int(v as i64))
            .ok(),
        "INT4" => row
            .try_get::<i32, _>(i)
            .map(|v| DbValue::Int(v as i64))
            .ok(),
        "INT8" => row.try_get::<i64, _>(i).map(DbValue::Int).ok(),
        "FLOAT4" => row
            .try_get::<f32, _>(i)
            .map(|v| DbValue::Float(v as f64))
            .ok(),
        "FLOAT8" => row.try_get::<f64, _>(i).map(DbValue::Float).ok(),
        "NUMERIC" => row
            .try_get::<sqlx::types::Decimal, _>(i)
            .map(|v| DbValue::Numeric(v.to_string()))
            .ok(),
        "TEXT" | "VARCHAR" | "BPCHAR" | "CHAR" | "NAME" | "UNKNOWN" => {
            row.try_get::<String, _>(i).map(DbValue::Text).ok()
        }
        "TIMESTAMPTZ" => row
            .try_get::<chrono::DateTime<chrono::Utc>, _>(i)
            .map(|v| DbValue::Timestamp(v.to_rfc3339()))
            .ok(),
        "TIMESTAMP" => row
            .try_get::<chrono::NaiveDateTime, _>(i)
            .map(|v| DbValue::Timestamp(v.to_string()))
            .ok(),
        "DATE" => row
            .try_get::<chrono::NaiveDate, _>(i)
            .map(|v| DbValue::Timestamp(v.to_string()))
            .ok(),
        "TIME" => row
            .try_get::<chrono::NaiveTime, _>(i)
            .map(|v| DbValue::Timestamp(v.to_string()))
            .ok(),
        "UUID" => row
            .try_get::<sqlx::types::Uuid, _>(i)
            .map(|v| DbValue::Uuid(v.to_string()))
            .ok(),
        "JSON" | "JSONB" => row
            .try_get::<serde_json::Value, _>(i)
            .map(|v| DbValue::Json(v.to_string()))
            .ok(),
        _ => None,
    };

    decoded.unwrap_or_else(|| DbValue::Fallback(format!("<{}>", type_name.to_lowercase())))
}
