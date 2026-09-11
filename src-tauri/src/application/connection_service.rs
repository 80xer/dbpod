use std::{collections::HashMap, sync::atomic::Ordering, time::Instant};

use sqlx::postgres::PgConnectOptions;
use sqlx::{Connection, PgConnection, Row};
use uuid::Uuid;

use crate::domain::*;
use crate::error::AppError;
use crate::infrastructure::platform::keychain;
use crate::infrastructure::postgres::session_actor::{SessionHandle, SessionMsg};
use crate::infrastructure::postgres::transport;
use crate::state::{AppState, Workspace};

const MAX_TIMEOUT_MS: u32 = 3_600_000;
const MAX_ROWS_LIMIT: u32 = 10_000;

fn validate_draft(d: &ProfileDraft) -> Result<(), AppError> {
    if d.name.trim().is_empty()
        || d.host.trim().is_empty()
        || d.database.trim().is_empty()
        || d.username.trim().is_empty()
        || d.port == 0
    {
        return Err(AppError::invalid_request(
            "name, host, database, username and a valid port are required",
        ));
    }
    if d.query_timeout_ms < 1_000 || d.query_timeout_ms > MAX_TIMEOUT_MS {
        return Err(AppError::invalid_request("queryTimeoutMs out of range"));
    }
    if d.max_rows == 0 || d.max_rows > MAX_ROWS_LIMIT {
        return Err(AppError::invalid_request("maxRows out of range"));
    }
    Ok(())
}

pub fn vault_status() -> VaultStatus {
    // macOS keychain needs no unlock step; master-password vault lands with Linux support.
    VaultStatus {
        state: "unlocked".into(),
        secure_storage_available: keychain::available(),
    }
}

pub fn profile_list(state: &AppState) -> Vec<ConnectionProfile> {
    state.profiles.lock().unwrap().list().to_vec()
}

pub fn profile_reorder(state: &AppState, profile_ids: &[String]) -> Result<(), AppError> {
    state.profiles.lock().unwrap().reorder(profile_ids)
}

pub fn profile_save(
    state: &AppState,
    req: ConnectionProfileSaveRequest,
) -> Result<ConnectionProfileSaveResponse, AppError> {
    validate_draft(&req.profile)?;
    if let Some(id) = &req.profile.id {
        if state
            .workspaces
            .lock()
            .unwrap()
            .values()
            .any(|ws| &ws.profile.id == id)
        {
            return Err(AppError::invalid_request(
                "close the open connection before editing its profile",
            ));
        }
    }
    let id = req
        .profile
        .id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let mut store = state.profiles.lock().unwrap();
    if req.profile.id.is_some() && store.get(&id).is_none() {
        return Err(AppError::invalid_request("cannot edit an unknown profile"));
    }
    let existing_credential = store
        .get(&id)
        .map(|p| p.has_stored_credential)
        .unwrap_or(false);

    let has_stored_credential = match &req.secret {
        SecretInput::Replace { password } => {
            keychain::set_password(&id, password)?;
            true
        }
        SecretInput::KeepExisting => existing_credential,
        SecretInput::PromptEachTime => {
            keychain::delete_password(&id)?;
            false
        }
    };

    let d = req.profile;
    store.upsert(ConnectionProfile {
        id: id.clone(),
        name: d.name,
        environment: d.environment,
        color: d.color,
        host: d.host,
        port: d.port,
        database: d.database,
        username: d.username,
        tls_mode: d.tls_mode,
        read_only: d.read_only,
        query_timeout_ms: d.query_timeout_ms,
        max_rows: d.max_rows,
        has_stored_credential,
    })?;
    Ok(ConnectionProfileSaveResponse { profile_id: id })
}

pub fn profile_delete(state: &AppState, profile_id: &str) -> Result<(), AppError> {
    let open = state
        .workspaces
        .lock()
        .unwrap()
        .values()
        .any(|w| w.profile.id == profile_id);
    if open {
        return Err(AppError::invalid_request(
            "close the open connection before deleting this profile",
        ));
    }
    keychain::delete_password(profile_id)?;
    state.profiles.lock().unwrap().remove(profile_id)
}

async fn probe(
    opts: &PgConnectOptions,
    tls_mode: TlsMode,
) -> Result<ConnectionTestResult, AppError> {
    let start = Instant::now();
    let mut conn = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        PgConnection::connect_with(opts),
    )
    .await
    .map_err(|_| AppError::new("CONNECTION_TIMEOUT", "connection timed out"))?
    .map_err(|e| AppError::from_sqlx(&e))?;
    let row = sqlx::query(
        "SELECT version(), current_user, current_database(), current_setting('is_superuser')",
    )
    .fetch_one(&mut conn)
    .await
    .map_err(|e| AppError::from_sqlx(&e))?;
    let latency_ms = start.elapsed().as_millis() as u32;
    let _ = conn.close().await;

    let mode = match tls_mode {
        TlsMode::VerifyFull => "verify-full",
        TlsMode::VerifyCa => "verify-ca",
        TlsMode::Insecure => "insecure",
    };
    Ok(ConnectionTestResult {
        server_version: row.get::<String, _>(0),
        current_user: row.get::<String, _>(1),
        database: row.get::<String, _>(2),
        is_superuser: row.get::<String, _>(3) == "on",
        latency_ms,
        tls: TlsStatus {
            enabled: tls_mode != TlsMode::Insecure,
            mode: mode.into(),
        },
    })
}

pub async fn connection_test(
    state: &AppState,
    req: ConnectionTestRequest,
) -> Result<ConnectionTestResult, AppError> {
    if let Some(draft) = &req.draft {
        validate_draft(draft)?;
        let password = match req.password {
            Some(password) => Some(password),
            None => match draft.id.as_deref() {
                Some(id) => {
                    let stored = state.profiles.lock().unwrap();
                    if stored.get(id).is_some_and(|p| p.has_stored_credential) {
                        keychain::get_password(id)?
                    } else {
                        None
                    }
                }
                None => None,
            },
        };
        let opts = transport::options_for_draft(draft, password.as_deref());
        return probe(&opts, draft.tls_mode).await;
    }
    let profile_id = req
        .profile_id
        .as_deref()
        .ok_or_else(|| AppError::invalid_request("profileId or draft is required"))?;
    let (opts, tls_mode) = {
        let store = state.profiles.lock().unwrap();
        let profile = store
            .get(profile_id)
            .ok_or_else(|| AppError::invalid_request("unknown profile"))?;
        let password = match req.password.clone() {
            Some(p) => Some(p),
            None => keychain::get_password(profile_id)?,
        };
        (
            transport::options_for_profile(profile, password.as_deref()),
            profile.tls_mode,
        )
    };
    probe(&opts, tls_mode).await
}

pub async fn connection_open(
    state: &AppState,
    req: ConnectionOpenRequest,
) -> Result<ConnectionOpenResponse, AppError> {
    let (profile, opts) = {
        let store = state.profiles.lock().unwrap();
        let profile = store
            .get(&req.profile_id)
            .ok_or_else(|| AppError::invalid_request("unknown profile"))?
            .clone();
        let password = match req.password {
            Some(password) => Some(password),
            None if profile.has_stored_credential => keychain::get_password(&profile.id)?,
            None => None,
        };
        if password.is_none() && profile.has_stored_credential {
            return Err(AppError::new("AUTH_ERROR", "stored credential is missing"));
        }
        let opts = transport::options_for_profile(&profile, password.as_deref());
        (profile, opts)
    };

    open_workspace(state, profile, opts).await
}

pub async fn connection_switch_database(
    state: &AppState,
    connection_id: &str,
    database: &str,
) -> Result<ConnectionOpenResponse, AppError> {
    if database.is_empty() || database.contains('\0') || database.len() > 63 {
        return Err(AppError::invalid_request("invalid database name"));
    }
    let (control, opts, previous_database) = {
        let workspaces = state.workspaces.lock().unwrap();
        let ws = workspaces
            .get(connection_id)
            .ok_or_else(|| AppError::invalid_request("unknown connection"))?;
        (
            ws.control.clone(),
            ws.connect_opts.clone().database(database),
            ws.profile.database.clone(),
        )
    };
    let mut guard = tokio::time::timeout(std::time::Duration::from_secs(5), control.lock())
        .await
        .map_err(|_| {
            AppError::new(
                "CONNECTION_BUSY",
                "metadata or edit operation is still in progress",
            )
        })?;
    {
        let workspaces = state.workspaces.lock().unwrap();
        let ws = workspaces
            .get(connection_id)
            .ok_or_else(|| AppError::invalid_request("connection was closed"))?;
        if ws.profile.database == database {
            return Ok(ConnectionOpenResponse {
                connection_id: connection_id.into(),
                profile_id: ws.profile.id.clone(),
                database: database.into(),
                server_version: String::new(),
            });
        }
        if ws.profile.database != previous_database {
            return Err(AppError::invalid_request("database already changed"));
        }
    }
    // Prepare the target before touching the current DB. Failed authentication leaves it intact.
    let (next_control, server_version) = connect_control(&opts).await?;
    let (sessions, profile_id, previous_control) = {
        let mut workspaces = state.workspaces.lock().unwrap();
        let ws = workspaces
            .get_mut(connection_id)
            .ok_or_else(|| AppError::invalid_request("connection was closed"))?;
        if ws.sessions.values().any(|s| {
            s.busy.load(Ordering::Acquire)
                || *s.transaction.lock().unwrap() != TransactionState::Idle
        }) {
            return Err(AppError::new(
                "CONNECTION_BUSY",
                "finish queries and transactions before changing database",
            ));
        }
        // Under the workspace lock, old results cannot be confused with new DB sessions.
        state
            .large_values
            .lock()
            .unwrap()
            .retain(|_, s| s.connection_id != connection_id);
        state
            .change_sets
            .lock()
            .unwrap()
            .retain(|_, s| s.connection_id != connection_id);
        state
            .executions
            .lock()
            .unwrap()
            .retain(|_, e| e.connection_id != connection_id);
        ws.profile.database = database.into();
        ws.connect_opts = opts;
        (
            std::mem::take(&mut ws.sessions),
            ws.profile.id.clone(),
            guard.replace(next_control),
        )
    };
    drop(guard);
    close_sessions(sessions).await;
    if let Some(c) = previous_control {
        let _ = c.close().await;
    }
    Ok(ConnectionOpenResponse {
        connection_id: connection_id.into(),
        profile_id,
        database: database.into(),
        server_version,
    })
}

async fn open_workspace(
    state: &AppState,
    profile: ConnectionProfile,
    opts: PgConnectOptions,
) -> Result<ConnectionOpenResponse, AppError> {
    // One connection item per profile, including after its current database changes.
    if let Some(ws) = state
        .workspaces
        .lock()
        .unwrap()
        .values()
        .find(|w| w.profile.id == profile.id)
    {
        return Ok(ConnectionOpenResponse {
            connection_id: ws.connection_id.clone(),
            profile_id: profile.id,
            database: ws.profile.database.clone(),
            server_version: String::new(),
        });
    }

    let (control, server_version) = connect_control(&opts).await?;

    let connection_id = Uuid::new_v4().to_string();
    let mut workspaces = state.workspaces.lock().unwrap();
    if let Some(ws) = workspaces.values().find(|w| w.profile.id == profile.id) {
        return Ok(ConnectionOpenResponse {
            connection_id: ws.connection_id.clone(),
            profile_id: profile.id,
            database: ws.profile.database.clone(),
            server_version,
        });
    }
    workspaces.insert(
        connection_id.clone(),
        Workspace {
            connection_id: connection_id.clone(),
            profile: profile.clone(),
            connect_opts: opts,
            control: std::sync::Arc::new(tokio::sync::Mutex::new(Some(control))),
            sessions: Default::default(),
        },
    );
    Ok(ConnectionOpenResponse {
        connection_id,
        profile_id: profile.id,
        database: profile.database,
        server_version,
    })
}

pub async fn connection_close(state: &AppState, connection_id: &str) -> Result<(), AppError> {
    let Some(ws) = state.workspaces.lock().unwrap().remove(connection_id) else {
        return Ok(());
    };

    state
        .large_values
        .lock()
        .unwrap()
        .retain(|_, store| store.connection_id != connection_id);
    state
        .change_sets
        .lock()
        .unwrap()
        .retain(|_, set| set.connection_id != connection_id);
    // Cancel any live executions of this connection.
    state.executions.lock().unwrap().retain(|_, e| {
        if e.connection_id == connection_id {
            e.cancel.cancel();
            false
        } else {
            true
        }
    });

    close_sessions(ws.sessions).await;
    if let Some(c) = ws.control.lock().await.take() {
        let _ = c.close().await;
    }
    Ok(())
}

async fn close_sessions(sessions: HashMap<String, SessionHandle>) {
    for handle in sessions.values() {
        let (tx, rx) = tokio::sync::oneshot::channel();
        if handle
            .tx
            .send(SessionMsg::Close {
                rollback: true,
                reply: tx,
            })
            .await
            .is_ok()
        {
            let _ = tokio::time::timeout(std::time::Duration::from_secs(5), rx).await;
        }
    }
}

async fn connect_control(opts: &PgConnectOptions) -> Result<(PgConnection, String), AppError> {
    let mut control = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        PgConnection::connect_with(opts),
    )
    .await
    .map_err(|_| AppError::new("CONNECTION_TIMEOUT", "connection timed out"))?
    .map_err(|e| AppError::from_sqlx(&e))?;
    sqlx::raw_sql("SET statement_timeout = '30s'")
        .execute(&mut control)
        .await
        .map_err(|e| AppError::from_sqlx(&e))?;
    let server_version = sqlx::query_scalar("SHOW server_version")
        .fetch_one(&mut control)
        .await
        .map_err(|e| AppError::from_sqlx(&e))?;
    Ok((control, server_version))
}
