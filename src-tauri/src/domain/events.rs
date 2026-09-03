use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::db_value::DbValue;
use crate::error::AppError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum ColumnCategory {
    Boolean,
    Integer,
    Decimal,
    Float,
    Text,
    Binary,
    Uuid,
    Temporal,
    Json,
    Array,
    Enum,
    Network,
    Range,
    Composite,
    Unknown,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ColumnSource {
    pub relation_oid: u32,
    pub attribute_number: i16,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMeta {
    pub index: u32,
    pub name: String,
    pub pg_type_oid: u32,
    pub pg_type_name: String,
    pub category: ColumnCategory,
    pub source: Option<ColumnSource>,
    pub nullable: Option<bool>,
    /// Conservative default until editability detection lands (Milestone C).
    pub editable: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum TransactionState {
    Idle,
    InTransaction,
    FailedTransaction,
}

/// Streamed over a per-execution Tauri Channel.
/// Ordering contract: `started` first, `columns` before any `rows`,
/// `rows.sequence` contiguous from 0, exactly one terminal event
/// (`completed` | `failed` | `cancelled`), nothing after the terminal.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum QueryStreamEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        execution_id: String,
        backend_pid: i32,
        started_at: String,
    },
    #[serde(rename_all = "camelCase")]
    Columns {
        execution_id: String,
        columns: Vec<ColumnMeta>,
    },
    #[serde(rename_all = "camelCase")]
    Rows {
        execution_id: String,
        #[ts(type = "number")]
        sequence: u64,
        rows: Vec<Vec<DbValue>>,
    },
    #[serde(rename_all = "camelCase")]
    Notice {
        execution_id: String,
        severity: String,
        message: String,
    },
    #[serde(rename_all = "camelCase")]
    Command {
        execution_id: String,
        command_tag: String,
        #[ts(type = "number | null")]
        affected_rows: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Completed {
        execution_id: String,
        #[ts(type = "number")]
        row_count: u64,
        truncated: bool,
        #[ts(type = "number")]
        duration_ms: u64,
        transaction_state: TransactionState,
    },
    #[serde(rename_all = "camelCase")]
    Failed {
        execution_id: String,
        error: AppError,
        #[ts(type = "number")]
        duration_ms: u64,
        transaction_state: TransactionState,
    },
    #[serde(rename_all = "camelCase")]
    Cancelled {
        execution_id: String,
        #[ts(type = "number")]
        received_row_count: u64,
        #[ts(type = "number")]
        duration_ms: u64,
        transaction_state: TransactionState,
    },
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct QuerySessionOpenRequest {
    pub connection_id: String,
    pub query_tab_id: String,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct QuerySessionOpenResponse {
    pub session_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct QuerySessionCloseRequest {
    pub session_id: String,
    pub rollback_open_transaction: bool,
}

/// SQL text is intentionally excluded from Debug output.
#[derive(Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct QueryExecuteRequest {
    pub connection_id: String,
    pub query_tab_id: String,
    pub result_tab_id: String,
    pub sql: String,
    pub max_rows: u32,
    pub timeout_ms: u32,
}

impl std::fmt::Debug for QueryExecuteRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("QueryExecuteRequest")
            .field("connection_id", &self.connection_id)
            .field("query_tab_id", &self.query_tab_id)
            .field("result_tab_id", &self.result_tab_id)
            .field("sql_bytes", &self.sql.len())
            .field("max_rows", &self.max_rows)
            .field("timeout_ms", &self.timeout_ms)
            .finish()
    }
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionAccepted {
    pub execution_id: String,
    pub session_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct QueryAckChunkRequest {
    pub execution_id: String,
    #[ts(type = "number")]
    pub sequence: u64,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct QueryCancelRequest {
    pub execution_id: String,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct QueryCancelResponse {
    /// "cancel-requested" | "already-terminal"
    pub state: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ResultValueFetchRequest {
    pub result_tab_id: String,
    pub value_handle: String,
    #[ts(type = "number")]
    pub offset: u64,
    pub length: u32,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ResultValueFetchResponse {
    /// base64 of the requested byte range
    pub data: String,
    pub eof: bool,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ResultReleaseRequest {
    pub result_tab_id: String,
}
