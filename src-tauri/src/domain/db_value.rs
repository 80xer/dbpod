use serde::Serialize;
use ts_rs::TS;

/// Milestone A value coverage. Numeric/temporal/uuid/json travel as strings
/// so no precision is lost in JS. Everything else falls back to a typed
/// placeholder until the full type spec lands (Milestone B).
#[derive(Debug, Clone, Serialize, TS)]
#[serde(tag = "t", content = "v", rename_all = "camelCase")]
pub enum DbValue {
    Null,
    Bool(bool),
    Int(#[ts(type = "number")] i64),
    Float(f64),
    Numeric(String),
    Text(String),
    Timestamp(String),
    Uuid(String),
    Json(String),
    Fallback(String),
}
