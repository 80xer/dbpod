use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum TemporalType {
    Date,
    Time,
    Timetz,
    Timestamp,
    Timestamptz,
    Interval,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum JsonType {
    Json,
    Jsonb,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ArrayDimension {
    pub lower_bound: i32,
    pub length: u32,
}

/// Lossless IPC value per docs/spec/postgresql_type_spec.md §4.
/// Numbers travel as canonical strings; JSON stays raw text; binary is
/// base64 with a handle beyond the inline limit.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum DbValue {
    Null,
    #[serde(rename_all = "camelCase")]
    Boolean { value: bool },
    #[serde(rename_all = "camelCase")]
    Integer { value: String },
    #[serde(rename_all = "camelCase")]
    Decimal { value: String },
    #[serde(rename_all = "camelCase")]
    Float { value: String },
    #[serde(rename_all = "camelCase")]
    Text { value: String },
    #[serde(rename_all = "camelCase")]
    Uuid { value: String },
    #[serde(rename_all = "camelCase")]
    Temporal {
        temporal_type: TemporalType,
        value: String,
    },
    #[serde(rename_all = "camelCase")]
    Json { value: String, json_type: JsonType },
    #[serde(rename_all = "camelCase")]
    Binary {
        encoding: String,
        value: Option<String>,
        #[ts(type = "number")]
        byte_length: u64,
        truncated: bool,
        value_handle: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Array {
        dimensions: Vec<ArrayDimension>,
        values: Vec<DbValue>,
        element_type_oid: u32,
    },
    #[serde(rename_all = "camelCase")]
    Enum { value: String, type_name: String },
    #[serde(rename_all = "camelCase")]
    Network {
        value: String,
        network_type: String,
    },
    #[serde(rename_all = "camelCase")]
    Range { value: String, range_type: String },
    #[serde(rename_all = "camelCase")]
    Composite { value: String, type_name: String },
    #[serde(rename_all = "camelCase")]
    Unknown {
        value: String,
        type_oid: u32,
        type_name: String,
    },
}

impl DbValue {
    pub fn text(v: impl Into<String>) -> Self {
        DbValue::Text { value: v.into() }
    }
    pub fn integer(v: impl ToString) -> Self {
        DbValue::Integer {
            value: v.to_string(),
        }
    }
}
