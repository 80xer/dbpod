use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Restored on app restart: SQL drafts and tab layout only.
/// Never contains result rows, pending edits or credentials.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    pub version: u32,
    pub connections: Vec<ConnectionSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSnapshot {
    pub profile_id: String,
    pub active_tab_index: Option<u32>,
    pub tabs: Vec<TabSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct TabSnapshot {
    pub title: String,
    pub sql: String,
}
