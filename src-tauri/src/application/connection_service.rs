use std::time::Instant;

use sqlx::postgres::PgConnectOptions;
use sqlx::{Connection, PgConnection, Row};
use uuid::Uuid;

use crate::domain::*;
use crate::error::AppError;
use crate::infrastructure::platform::keychain;
use crate::infrastructure::postgres::transport;
use crate::state::{AppState, Workspace};

const MAX_TIMEOUT_MS: u32 = 3_600_000;
const MAX_ROWS_LIMIT: u32 = 10_000;

fn validate_draft(d: &ProfileDraft) -> Result<(), AppError> {
    if d.name.trim().is_empty() || d.host.trim().is_empty() || d.database.trim().is_empty() {
        return Err(AppError::invalid_request(
            "name, host and database are required",
        ));
    }
    if d.query_timeout_ms == 0 || d.query_timeout_ms > MAX_TIMEOUT_MS {
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

pub fn profile_save(
    state: &AppState,
    req: ConnectionProfileSaveRequest,
) -> Result<ConnectionProfileSaveResponse, AppError> {
    validate_draft(&req.profile)?;
    let id = req
        .profile
        .id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let mut store = state.profiles.lock().unwrap();
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
    let mut conn = PgConnection::connect_with(opts)
        .await
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
        let opts = transport::options_for_draft(draft, req.password.as_deref());
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
        let password = keychain::get_password(&profile.id)?;
        if password.is_none() && profile.has_stored_credential {
            return Err(AppError::new("AUTH_ERROR", "stored credential is missing"));
        }
        let opts = transport::options_for_profile(&profile, password.as_deref());
        (profile, opts)
    };

    // Idempotent: reuse an already-open workspace for the same profile.
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
            server_version: String::new(),
        });
    }

    // Validate credentials/TLS eagerly and keep the connection as the control conn.
    let mut control = PgConnection::connect_with(&opts)
        .await
        .map_err(|e| AppError::from_sqlx(&e))?;
    let server_version: String = sqlx::query_scalar("SHOW server_version")
        .fetch_one(&mut control)
        .await
        .map_err(|e| AppError::from_sqlx(&e))?;

    let connection_id = Uuid::new_v4().to_string();
    state.workspaces.lock().unwrap().insert(
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
        server_version,
    })
}

pub async fn connection_close(state: &AppState, connection_id: &str) -> Result<(), AppError> {
    let ws = state
        .workspaces
        .lock()
        .unwrap()
        .remove(connection_id)
        .ok_or_else(|| AppError::invalid_request("unknown connection"))?;

    // Cancel any live executions of this connection.
    state.executions.lock().unwrap().retain(|_, e| {
        if e.connection_id == connection_id {
            e.cancel.cancel();
            false
        } else {
            true
        }
    });

    for handle in ws.sessions.values() {
        let (tx, rx) = tokio::sync::oneshot::channel();
        if handle
            .tx
            .send(
                crate::infrastructure::postgres::session_actor::SessionMsg::Close {
                    rollback: true,
                    reply: tx,
                },
            )
            .await
            .is_ok()
        {
            let _ = tokio::time::timeout(std::time::Duration::from_secs(5), rx).await;
        }
    }
    if let Some(c) = ws.control.lock().await.take() {
        let _ = c.close().await;
    }
    Ok(())
}
