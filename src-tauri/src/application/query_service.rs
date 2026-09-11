use std::sync::atomic::Ordering;
use std::sync::Arc;

use uuid::Uuid;

use crate::domain::events::*;
use crate::error::AppError;
use crate::infrastructure::postgres::large_values::LargeValueStore;
use crate::infrastructure::postgres::session_actor::{
    spawn_session, EventSink, ExecutionState, SessionMsg,
};
use crate::state::AppState;

const MAX_SQL_BYTES: usize = 1024 * 1024;
const MAX_SESSIONS_PER_CONNECTION: usize = 8;

/// Idempotent per queryTabId: returns the existing session if one is open.
pub fn session_open(
    state: &AppState,
    req: &QuerySessionOpenRequest,
) -> Result<QuerySessionOpenResponse, AppError> {
    let mut workspaces = state.workspaces.lock().unwrap();
    let ws = workspaces
        .get_mut(&req.connection_id)
        .ok_or_else(|| AppError::invalid_request("unknown connection"))?;

    if let Some(handle) = ws.sessions.get(&req.query_tab_id) {
        return Ok(QuerySessionOpenResponse {
            session_id: handle.session_id.clone(),
        });
    }
    if ws.sessions.len() >= MAX_SESSIONS_PER_CONNECTION {
        return Err(AppError::new(
            "SESSION_LIMIT_REACHED",
            "too many open query sessions for this connection",
        ));
    }
    let session_id = Uuid::new_v4().to_string();
    let handle = spawn_session(
        session_id.clone(),
        req.query_tab_id.clone(),
        ws.connect_opts.clone(),
        ws.profile.read_only,
    );
    ws.sessions.insert(req.query_tab_id.clone(), handle);
    Ok(QuerySessionOpenResponse { session_id })
}

pub async fn session_close(
    state: &AppState,
    req: &QuerySessionCloseRequest,
) -> Result<(), AppError> {
    let handle = {
        let mut workspaces = state.workspaces.lock().unwrap();
        let mut found = None;
        for ws in workspaces.values_mut() {
            if let Some(tab_id) = ws
                .sessions
                .iter()
                .find(|(_, h)| h.session_id == req.session_id)
                .map(|(k, _)| k.clone())
            {
                let h = &ws.sessions[&tab_id];
                if !req.rollback_open_transaction
                    && (h.busy.load(Ordering::Acquire)
                        || *h.transaction.lock().unwrap() != TransactionState::Idle)
                {
                    return Err(AppError::invalid_request(
                        "confirm rollback before closing an active session",
                    ));
                }
                found = ws.sessions.remove(&tab_id);
                break;
            }
        }
        found.ok_or_else(|| AppError::invalid_request("unknown session"))?
    };

    // Stop a running execution first so Close isn't stuck behind it.
    state.executions.lock().unwrap().retain(|_, e| {
        if e.session_id == req.session_id {
            e.cancel.cancel();
            false
        } else {
            true
        }
    });

    let (tx, rx) = tokio::sync::oneshot::channel();
    handle
        .tx
        .send(SessionMsg::Close {
            rollback: req.rollback_open_transaction,
            reply: tx,
        })
        .await
        .map_err(|_| AppError::internal("session already gone"))?;
    tokio::time::timeout(std::time::Duration::from_secs(5), rx)
        .await
        .map_err(|_| AppError::internal("session close timed out"))?
        .map_err(|_| AppError::internal("session closed without confirmation"))?;
    let ids: Vec<String> = state
        .large_values
        .lock()
        .unwrap()
        .iter()
        .filter(|(_, store)| store.query_tab_id == handle.query_tab_id)
        .map(|(id, _)| id.clone())
        .collect();
    for result_tab_id in ids {
        result_release(state, &ResultReleaseRequest { result_tab_id })?;
    }
    Ok(())
}

pub fn execute(
    state: &AppState,
    req: QueryExecuteRequest,
    sink: EventSink,
) -> Result<ExecutionAccepted, AppError> {
    execute_with_paging(state, req, sink, false)
}

pub fn execute_with_paging(
    state: &AppState,
    req: QueryExecuteRequest,
    sink: EventSink,
    paged: bool,
) -> Result<ExecutionAccepted, AppError> {
    if req.sql.trim().is_empty() {
        return Err(AppError::invalid_request("sql is empty"));
    }
    if req.sql.len() > MAX_SQL_BYTES {
        return Err(AppError::invalid_request("sql exceeds 1 MiB"));
    }
    // Paged queries use retained-byte budgets, not the legacy profile row cap.
    if !paged && (req.max_rows == 0 || req.max_rows > 10_000) {
        return Err(AppError::invalid_request("maxRows out of range"));
    }
    if req.timeout_ms < 1_000 || req.timeout_ms > 3_600_000 {
        return Err(AppError::invalid_request("timeoutMs out of range"));
    }

    // Lazy session: opening on first execution keeps the FE flow simple.
    let session_id = session_open(
        state,
        &QuerySessionOpenRequest {
            connection_id: req.connection_id.clone(),
            query_tab_id: req.query_tab_id.clone(),
        },
    )?
    .session_id;

    let (handle, execution) = {
        let workspaces = state.workspaces.lock().unwrap();
        let ws = workspaces
            .get(&req.connection_id)
            .ok_or_else(|| AppError::invalid_request("unknown connection"))?;
        let handle = ws
            .sessions
            .get(&req.query_tab_id)
            .ok_or_else(|| AppError::invalid_request("unknown session"))?
            .clone();

        if let Some(store) = state.large_values.lock().unwrap().get(&req.result_tab_id) {
            if store.connection_id != req.connection_id || store.query_tab_id != req.query_tab_id {
                return Err(AppError::invalid_request(
                    "result belongs to another session",
                ));
            }
        }
        if handle.busy.swap(true, Ordering::AcqRel) {
            return Err(AppError::new(
                "QUERY_ALREADY_RUNNING",
                "this query tab already has a running execution",
            ));
        }
        state
            .change_sets
            .lock()
            .unwrap()
            .retain(|_, set| set.result_tab_id != req.result_tab_id);
        // Fresh large-value store per execution; replacing a result tab drops
        // the previous execution's handles.
        let mut large = LargeValueStore::owned(
            req.connection_id.clone(),
            req.query_tab_id.clone(),
            state.retained_usage.clone(),
        );
        large.paged = paged;
        let large = Arc::new(large);
        state
            .large_values
            .lock()
            .unwrap()
            .insert(req.result_tab_id.clone(), large.clone());
        let execution = Arc::new(ExecutionState::new(
            large.execution_id.clone(),
            session_id.clone(),
            req.connection_id.clone(),
            handle.backend_pid.clone(),
            large,
        ));
        (handle, execution)
    };

    state
        .executions
        .lock()
        .unwrap()
        .insert(execution.id.clone(), execution.clone());

    let accepted = ExecutionAccepted {
        execution_id: execution.id.clone(),
        session_id,
    };

    if handle
        .tx
        .try_send(SessionMsg::Execute {
            request: req,
            execution: execution.clone(),
            sink,
        })
        .is_err()
    {
        handle.busy.store(false, Ordering::Release);
        state.executions.lock().unwrap().remove(&execution.id);
        return Err(AppError::internal("session mailbox unavailable"));
    }
    Ok(accepted)
}

/// Table Data browsing: SQL is assembled in Rust from catalog-validated
/// identifiers only; xmin rides along as row identity for editing.
pub async fn table_data_execute(
    state: &AppState,
    req: crate::domain::metadata::TableDataExecuteRequest,
    sink: EventSink,
) -> Result<ExecutionAccepted, AppError> {
    use crate::application::metadata_service::{self, quote_ident};

    if req.limit == 0 || req.limit > 10_000 {
        return Err(AppError::invalid_request("limit out of range"));
    }
    let meta = metadata_service::get_table(
        state,
        &crate::domain::metadata::MetadataGetTableRequest {
            connection_id: req.connection_id.clone(),
            relation_oid: req.relation_oid,
        },
    )
    .await?;

    let mut order_columns = Vec::new();
    if let Some(att) = req.sort_attribute {
        let col = meta
            .columns
            .iter()
            .find(|c| c.attribute_number == att)
            .ok_or_else(|| AppError::invalid_request("unknown sort column"))?;
        order_columns.push(format!(
            "{} {}",
            quote_ident(&col.name),
            if req.sort_descending { "DESC" } else { "ASC" }
        ));
    }
    for att in &meta.primary_key {
        if Some(*att) != req.sort_attribute {
            if let Some(col) = meta.columns.iter().find(|c| c.attribute_number == *att) {
                order_columns.push(quote_ident(&col.name));
            }
        }
    }
    let order = if order_columns.is_empty() {
        String::new()
    } else {
        format!(" ORDER BY {}", order_columns.join(", "))
    };
    let is_base_table = meta.kind == "table" || meta.kind == "partitioned-table";
    let xmin_sel = if is_base_table {
        "t.xmin::text AS __dbpod_xmin, "
    } else {
        ""
    };
    let sql = format!(
        "SELECT {xmin_sel}t.* FROM {}.{} t{order} LIMIT {} OFFSET {}",
        quote_ident(&meta.schema),
        quote_ident(&meta.name),
        req.limit,
        req.offset
    );
    execute(
        state,
        QueryExecuteRequest {
            connection_id: req.connection_id,
            query_tab_id: req.query_tab_id,
            result_tab_id: req.result_tab_id,
            sql,
            max_rows: req.limit,
            timeout_ms: 60_000,
        },
        sink,
    )
}

pub fn result_value_fetch(
    state: &AppState,
    req: &ResultValueFetchRequest,
) -> Result<ResultValueFetchResponse, AppError> {
    let store = state
        .large_values
        .lock()
        .unwrap()
        .get(&req.result_tab_id)
        .cloned()
        .ok_or_else(|| AppError::invalid_request("unknown result tab"))?;
    let (bytes, eof) = store.read(&req.value_handle, req.offset, req.length)?;
    use base64::Engine;
    Ok(ResultValueFetchResponse {
        data: base64::engine::general_purpose::STANDARD.encode(bytes),
        eof,
    })
}

pub fn result_rows_fetch(
    state: &AppState,
    req: &ResultRowsFetchRequest,
) -> Result<ResultRowsFetchResponse, AppError> {
    let store = state
        .large_values
        .lock()
        .unwrap()
        .get(&req.result_tab_id)
        .cloned()
        .ok_or_else(|| AppError::invalid_request("unknown result tab"))?;
    store.read_rows(&req.execution_id, req.offset)
}

pub fn result_release(state: &AppState, req: &ResultReleaseRequest) -> Result<(), AppError> {
    let mut stores = state.large_values.lock().unwrap();
    if let Some(store) = stores.get(&req.result_tab_id) {
        if state
            .executions
            .lock()
            .unwrap()
            .values()
            .any(|e| !e.is_terminal() && Arc::ptr_eq(&e.large, store))
        {
            return Err(AppError::invalid_request(
                "cancel execution before releasing its result",
            ));
        }
    }
    stores.remove(&req.result_tab_id);
    state
        .change_sets
        .lock()
        .unwrap()
        .retain(|_, set| set.result_tab_id != req.result_tab_id);
    Ok(())
}

pub fn ack_chunk(state: &AppState, req: &QueryAckChunkRequest) -> Result<(), AppError> {
    let exec = state
        .executions
        .lock()
        .unwrap()
        .get(&req.execution_id)
        .cloned();
    match exec {
        Some(e) => e.ack(req.sequence),
        // Terminal executions are already deregistered; late acks are harmless.
        None => Ok(()),
    }
}

pub async fn cancel(
    state: &AppState,
    req: &QueryCancelRequest,
) -> Result<QueryCancelResponse, AppError> {
    let exec = state
        .executions
        .lock()
        .unwrap()
        .get(&req.execution_id)
        .cloned();
    let Some(exec) = exec else {
        return Ok(QueryCancelResponse {
            state: "already-terminal".into(),
        });
    };
    if exec.is_terminal() {
        return Ok(QueryCancelResponse {
            state: "already-terminal".into(),
        });
    }
    exec.cancel.cancel();

    // The owning actor sends cancellation over a dedicated connection and confirms the server outcome.
    Ok(QueryCancelResponse {
        state: "cancel-requested".into(),
    })
}
