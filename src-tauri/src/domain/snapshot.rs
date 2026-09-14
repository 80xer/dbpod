use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Restored on app restart: SQL drafts and tab layout only.
/// Never contains result rows, pending edits or credentials.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    pub version: u32,
    pub connections: Vec<ConnectionSnapshot>,
    /// Named SQL snippets, deliberately global: not scoped to a profile or database.
    #[serde(default)]
    pub saved_queries: Vec<SavedQuery>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SavedQuery {
    pub id: String,
    pub name: String,
    pub sql: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSnapshot {
    pub profile_id: String,
    #[serde(default)]
    pub database: Option<String>,
    pub active_tab_index: Option<u32>,
    pub tabs: Vec<TabSnapshot>,
    #[serde(default)]
    pub tab_groups: Vec<TabGroupSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct TabSnapshot {
    pub title: String,
    pub sql: String,
    #[serde(default)]
    pub id: Option<String>,
    /// The saved query this tab edits, so Cmd+S still overwrites after a restart.
    #[serde(default)]
    pub saved_query_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct TabGroupSnapshot {
    pub id: String,
    pub tab_ids: Vec<String>,
    #[serde(default)]
    pub active_tab_id: Option<String>,
}
