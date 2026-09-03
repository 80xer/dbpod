// Thin Tauri adapters: deserialize, validate, call the application service,
// serialize AppError. No business rules here.
use std::sync::Arc;

use tauri::ipc::Channel;
use tauri::State;

use crate::application::{connection_service, query_service};
use crate::domain::*;
use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
pub fn vault_status() -> VaultStatus {
    connection_service::vault_status()
}

#[tauri::command]
pub fn connection_profile_list(state: State<'_, AppState>) -> Vec<ConnectionProfile> {
    connection_service::profile_list(&state)
}

#[tauri::command]
pub fn connection_profile_save(
    state: State<'_, AppState>,
    request: ConnectionProfileSaveRequest,
) -> Result<ConnectionProfileSaveResponse, AppError> {
    connection_service::profile_save(&state, request)
}

#[tauri::command]
pub fn connection_profile_delete(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<(), AppError> {
    connection_service::profile_delete(&state, &profile_id)
}

#[tauri::command]
pub async fn connection_test(
    state: State<'_, AppState>,
    request: ConnectionTestRequest,
) -> Result<ConnectionTestResult, AppError> {
    connection_service::connection_test(&state, request).await
}

#[tauri::command]
pub async fn connection_open(
    state: State<'_, AppState>,
    request: ConnectionOpenRequest,
) -> Result<ConnectionOpenResponse, AppError> {
    connection_service::connection_open(&state, request).await
}

#[tauri::command]
pub async fn connection_close(
    state: State<'_, AppState>,
    request: ConnectionCloseRequest,
) -> Result<(), AppError> {
    connection_service::connection_close(&state, &request.connection_id).await
}

#[tauri::command]
pub fn query_session_open(
    state: State<'_, AppState>,
    request: QuerySessionOpenRequest,
) -> Result<QuerySessionOpenResponse, AppError> {
    query_service::session_open(&state, &request)
}

#[tauri::command]
pub async fn query_session_close(
    state: State<'_, AppState>,
    request: QuerySessionCloseRequest,
) -> Result<(), AppError> {
    query_service::session_close(&state, &request).await
}

#[tauri::command]
pub fn query_execute(
    state: State<'_, AppState>,
    request: QueryExecuteRequest,
    on_event: Channel<QueryStreamEvent>,
) -> Result<ExecutionAccepted, AppError> {
    let executions = state.executions.clone();
    let sink: crate::infrastructure::postgres::session_actor::EventSink =
        Arc::new(move |event: QueryStreamEvent| {
            let terminal_of = match &event {
                QueryStreamEvent::Completed { execution_id, .. }
                | QueryStreamEvent::Failed { execution_id, .. }
                | QueryStreamEvent::Cancelled { execution_id, .. } => Some(execution_id.clone()),
                _ => None,
            };
            let delivered = on_event.send(event).is_ok();
            if let Some(id) = terminal_of {
                executions.lock().unwrap().remove(&id);
            }
            delivered
        });
    query_service::execute(&state, request, sink)
}

#[tauri::command]
pub fn query_ack_chunk(
    state: State<'_, AppState>,
    request: QueryAckChunkRequest,
) -> Result<(), AppError> {
    query_service::ack_chunk(&state, &request)
}

#[tauri::command]
pub async fn query_cancel(
    state: State<'_, AppState>,
    request: QueryCancelRequest,
) -> Result<QueryCancelResponse, AppError> {
    query_service::cancel(&state, &request).await
}
