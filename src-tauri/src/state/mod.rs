use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use sqlx::postgres::PgConnectOptions;
use sqlx::PgConnection;

use crate::domain::ConnectionProfile;
use crate::infrastructure::persistence::profiles::ProfileStore;
use crate::infrastructure::postgres::large_values::LargeValueStore;
use crate::infrastructure::postgres::session_actor::{ExecutionState, SessionHandle};

pub struct Workspace {
    pub connection_id: String,
    pub profile: ConnectionProfile,
    /// Includes the password; lives only in Rust memory.
    pub connect_opts: PgConnectOptions,
    /// Lazy control connection used for pg_cancel_backend and health checks.
    /// ponytail: single connection, grow to a pool when metadata browsing lands.
    pub control: Arc<tokio::sync::Mutex<Option<PgConnection>>>,
    /// queryTabId -> session actor handle
    pub sessions: HashMap<String, SessionHandle>,
}

pub struct AppState {
    pub profiles: Mutex<ProfileStore>,
    /// connectionId -> Workspace
    pub workspaces: Mutex<HashMap<String, Workspace>>,
    /// executionId -> live execution (removed when terminal).
    /// Arc so event sinks can deregister without holding AppState.
    pub executions: Arc<Mutex<HashMap<String, Arc<ExecutionState>>>>,
    /// resultTabId -> large-value store (dropped on result_release).
    pub large_values: Mutex<HashMap<String, Arc<LargeValueStore>>>,
}

impl AppState {
    pub fn new(profiles: ProfileStore) -> Self {
        Self {
            profiles: Mutex::new(profiles),
            workspaces: Mutex::new(HashMap::new()),
            executions: Arc::new(Mutex::new(HashMap::new())),
            large_values: Mutex::new(HashMap::new()),
        }
    }
}
