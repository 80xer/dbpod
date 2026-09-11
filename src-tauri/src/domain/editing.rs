use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::db_value::DbValue;
use crate::error::AppError;

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(tag = "mode", rename_all = "lowercase")]
pub enum InsertCellDraft {
    #[serde(rename_all = "camelCase")]
    Value {
        value: DbValue,
    },
    Null,
    Default,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PrimaryKeyValue {
    pub attribute_number: i16,
    pub column_name: String,
    pub value: DbValue,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RowIdentity {
    pub relation_oid: u32,
    pub primary_key: Vec<PrimaryKeyValue>,
    pub xmin: Option<String>,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(tag = "operation", rename_all = "lowercase")]
pub enum RowChange {
    #[serde(rename_all = "camelCase")]
    Update {
        row_id: String,
        identity: RowIdentity,
        original_values: HashMap<String, DbValue>,
        changes: HashMap<String, DbValue>,
    },
    #[serde(rename_all = "camelCase")]
    Insert {
        row_id: String,
        values: HashMap<String, InsertCellDraft>,
    },
    #[serde(rename_all = "camelCase")]
    Delete {
        row_id: String,
        identity: RowIdentity,
        original_values: HashMap<String, DbValue>,
    },
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ChangesPreviewRequest {
    pub connection_id: String,
    pub result_tab_id: String,
    pub relation_oid: u32,
    pub changes: Vec<RowChange>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ChangeTarget {
    pub schema: String,
    pub table: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ChangeCounts {
    pub insert: u32,
    pub update: u32,
    pub delete: u32,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct StatementPreview {
    /// "insert" | "update" | "delete"
    pub operation: String,
    pub sql_template: String,
    pub parameter_types: Vec<String>,
    pub row_count: u32,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ChangesPreviewResponse {
    pub change_set_id: String,
    pub expires_at: String,
    pub target: ChangeTarget,
    pub counts: ChangeCounts,
    pub statements: Vec<StatementPreview>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ChangesCommitRequest {
    pub change_set_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ChangesDiscardRequest {
    pub change_set_id: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct UpdatedRow {
    pub row_id: String,
    /// "insert" | "update" | "delete"
    pub operation: String,
    /// Authoritative server-returned values by column name (empty for delete).
    pub values: HashMap<String, DbValue>,
    pub xmin: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RowConflict {
    pub row_id: String,
    pub reason: String,
    /// Latest server values by column name; None when the row no longer exists.
    pub current: Option<HashMap<String, DbValue>>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChangesCommitEvent {
    #[serde(rename_all = "camelCase")]
    Started { total_rows: u32 },
    #[serde(rename_all = "camelCase")]
    Progress { completed_rows: u32 },
    #[serde(rename_all = "camelCase")]
    Completed { rows: Vec<UpdatedRow> },
    #[serde(rename_all = "camelCase")]
    Conflict { conflicts: Vec<RowConflict> },
    #[serde(rename_all = "camelCase")]
    Failed { error: AppError },
}
