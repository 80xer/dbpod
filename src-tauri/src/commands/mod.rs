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
pub async fn changes_preview(
    state: State<'_, AppState>,
    request: crate::domain::editing::ChangesPreviewRequest,
) -> Result<crate::domain::editing::ChangesPreviewResponse, AppError> {
    crate::application::edit_service::preview(&state, &request).await
}

#[tauri::command]
pub async fn changes_commit(
    state: State<'_, AppState>,
    request: crate::domain::editing::ChangesCommitRequest,
    on_event: Channel<crate::domain::editing::ChangesCommitEvent>,
) -> Result<(), AppError> {
    let sink: crate::application::edit_service::CommitSink =
        Arc::new(move |event| on_event.send(event).is_ok());
    crate::application::edit_service::commit(&state, &request, sink).await
}

#[tauri::command]
pub fn changes_discard(
    state: State<'_, AppState>,
    request: crate::domain::editing::ChangesDiscardRequest,
) -> Result<(), AppError> {
    crate::application::edit_service::discard(&state, &request)
}

#[tauri::command]
pub fn workspace_snapshot_load(
    state: State<'_, AppState>,
) -> Result<Option<crate::domain::snapshot::WorkspaceSnapshot>, AppError> {
    crate::infrastructure::persistence::snapshot::load(&state.data_dir)
}

#[tauri::command]
pub fn workspace_snapshot_save(
    state: State<'_, AppState>,
    snapshot: crate::domain::snapshot::WorkspaceSnapshot,
) -> Result<(), AppError> {
    crate::infrastructure::persistence::snapshot::save(&state.data_dir, &snapshot)
}

#[tauri::command]
pub async fn metadata_list_schemas(
    state: State<'_, AppState>,
    request: crate::domain::metadata::MetadataListSchemasRequest,
) -> Result<Vec<crate::domain::metadata::SchemaInfo>, AppError> {
    crate::application::metadata_service::list_schemas(&state, &request).await
}

#[tauri::command]
pub async fn metadata_list_objects(
    state: State<'_, AppState>,
    request: crate::domain::metadata::MetadataListObjectsRequest,
) -> Result<Vec<crate::domain::metadata::DatabaseObjectSummary>, AppError> {
    crate::application::metadata_service::list_objects(&state, &request).await
}

#[tauri::command]
pub async fn metadata_get_table(
    state: State<'_, AppState>,
    request: crate::domain::metadata::MetadataGetTableRequest,
) -> Result<crate::domain::metadata::TableMetadata, AppError> {
    crate::application::metadata_service::get_table(&state, &request).await
}

#[tauri::command]
pub async fn table_data_execute(
    state: State<'_, AppState>,
    request: crate::domain::metadata::TableDataExecuteRequest,
    on_event: Channel<QueryStreamEvent>,
) -> Result<ExecutionAccepted, AppError> {
    let sink = channel_sink(state.executions.clone(), on_event);
    query_service::table_data_execute(&state, request, sink).await
}

fn channel_sink(
    executions: Arc<
        std::sync::Mutex<
            std::collections::HashMap<
                String,
                Arc<crate::infrastructure::postgres::session_actor::ExecutionState>,
            >,
        >,
    >,
    on_event: Channel<QueryStreamEvent>,
) -> crate::infrastructure::postgres::session_actor::EventSink {
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
    })
}

#[tauri::command]
pub fn query_execute(
    state: State<'_, AppState>,
    request: QueryExecuteRequest,
    on_event: Channel<QueryStreamEvent>,
) -> Result<ExecutionAccepted, AppError> {
    let sink = channel_sink(state.executions.clone(), on_event);
    query_service::execute(&state, request, sink)
}

#[tauri::command]
pub fn result_value_fetch(
    state: State<'_, AppState>,
    request: ResultValueFetchRequest,
) -> Result<ResultValueFetchResponse, AppError> {
    query_service::result_value_fetch(&state, &request)
}

#[tauri::command]
pub fn result_release(
    state: State<'_, AppState>,
    request: ResultReleaseRequest,
) -> Result<(), AppError> {
    query_service::result_release(&state, &request)
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

pub mod export;
