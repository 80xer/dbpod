// Thin Tauri adapters: deserialize, validate, call the application service,
// serialize AppError. No business rules here.
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::Command;
use ts_rs::TS;

use tauri::ipc::Channel;
use tauri::State;

use crate::application::{connection_service, query_service};
use crate::domain::*;
use crate::error::AppError;
use crate::state::AppState;

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AiChatRequest {
    pub provider: String,
    pub model: String,
    pub thinking: String,
    pub prompt: String,
    pub request_id: Option<String>,
    /// The conversation this turn belongs to. None starts a new one; the id of
    /// the conversation that began comes back as an AiChatEvent::Session.
    #[serde(default)]
    pub session_id: Option<String>,
}
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AiChatCancelRequest { pub request_id: String }
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "type")]
pub enum AiChatEvent { Chunk { text: String }, Progress { text: String }, Session { id: String }, Approval { #[ts(type = "number")] approval_id: i64, message: String, detail: Option<String> }, Completed, Failed { message: String } }

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AiChatApproveRequest { pub request_id: String, #[ts(type = "number")] pub approval_id: i64, pub approved: bool }

/// Read-only tools the AI panel may use. `claude -p` is non-interactive, so
/// nobody is there to answer a permission prompt and anything not listed here
/// is denied outright. Schema inspection only: writing a query is the panel's
/// job, running one is the editor's, so `run_query` is deliberately absent.
const AI_ALLOWED_TOOLS: [&str; 17] = [
    "Read",
    "Grep",
    "Glob",
    "mcp__niv-db__db_overview",
    "mcp__niv-db__list_schemas",
    "mcp__niv-db__list_tables",
    "mcp__niv-db__describe_table",
    "mcp__niv-db__search_columns",
    "mcp__niv-db__column_stats",
    "mcp__niv-db__table_stats",
    "mcp__niv-db__row_count",
    "mcp__niv-db__list_indexes",
    "mcp__niv-db__list_foreign_keys",
    "mcp__niv-db__list_functions",
    "mcp__niv-db__sample_data",
    "mcp__niv-db__generate_erd_mermaid",
    "mcp__niv-db__generate_data_dictionary",
];

#[tauri::command]
pub async fn ai_chat(
    state: State<'_, AppState>,
    request: AiChatRequest,
    on_event: Channel<AiChatEvent>,
) -> Result<String, AppError> {
    if !["claude", "codex"].contains(&request.provider.as_str()) || request.prompt.trim().is_empty() {
        return Err(AppError::invalid_request("AI provider and prompt are required"));
    }
    let request_id = request.request_id.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    if request.provider == "codex" {
        run_codex_app_server(state, request_id.clone(), request, on_event).await?;
        return Ok(request_id);
    }
    let mut command = Command::new("claude");
    command.args([
        "-p",
        &request.prompt,
        "--output-format",
        "stream-json",
        "--include-partial-messages",
        "--verbose",
        "--model",
        &request.model,
    ]);
    // Context carries in the CLI's own session rather than by replaying earlier
    // messages into the prompt: the CLI keeps the full history, its tool calls
    // and its prompt cache, none of which survive a re-stated transcript.
    let session_id = match &request.session_id {
        Some(existing) => {
            command.args(["--resume", existing]);
            existing.clone()
        }
        None => {
            let fresh = uuid::Uuid::new_v4().to_string();
            command.args(["--session-id", &fresh]);
            fresh
        }
    };
    let _ = on_event.send(AiChatEvent::Session { id: session_id });
    command.arg("--allowedTools").args(AI_ALLOWED_TOOLS);
    if request.thinking != "auto" {
        command.args(["--effort", &request.thinking]);
    }
    command.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());
    command_execute_with_cancel(state, request_id.clone(), command, on_event).await?;
    Ok(request_id)
}

#[tauri::command]
pub async fn ai_chat_cancel(
    state: State<'_, AppState>,
    request: AiChatCancelRequest,
) -> Result<bool, AppError> {
    let pid = {
        let mut jobs = state
            .ai_chat_jobs
            .lock()
            .map_err(|_| AppError::internal("AI 취소 상태를 확인할 수 없습니다"))?;
        let job = jobs.get_mut(&request.request_id);
        if let Some(job) = job {
            job.canceled = true;
            job.pid
        } else {
            return Ok(false);
        }
    };
    #[cfg(target_family = "unix")]
    {
        let _ = std::process::Command::new("kill").args(["-9", &pid.to_string()]).status();
    }
    #[cfg(target_family = "windows")]
    {
        let _ = std::process::Command::new("taskkill").args(["/T", "/F", "/PID", &pid.to_string()]).status();
    }
    Ok(true)
}

/// Answers one approval request from the agent waiting on the other end.
#[tauri::command]
pub async fn ai_chat_approve(
    state: State<'_, AppState>,
    request: AiChatApproveRequest,
) -> Result<bool, AppError> {
    let jobs = state
        .ai_chat_jobs
        .lock()
        .map_err(|_| AppError::internal("AI 승인 상태를 확인할 수 없습니다"))?;
    let Some(approvals) = jobs.get(&request.request_id).and_then(|job| job.approvals.as_ref()) else {
        return Ok(false);
    };
    let action = if request.approved { "accept" } else { "decline" };
    Ok(approvals
        .send(serde_json::json!({"id": request.approval_id, "result": {"action": action}}))
        .is_ok())
}

async fn command_execute_with_cancel(
    state: State<'_, AppState>,
    request_id: String,
    mut command: Command,
    on_event: Channel<AiChatEvent>,
) -> Result<(), AppError> {
    let mut child = command
        .spawn()
        .map_err(|e| AppError::new("AI_UNAVAILABLE", format!("{} CLI를 실행할 수 없습니다: {e}", command.as_std().get_program().to_string_lossy())))?;
    let pid = child
        .id()
        .and_then(|id| i32::try_from(id).ok())
        .ok_or_else(|| AppError::internal("AI 프로세스 id를 읽지 못했습니다"))?;
    let stdout = child.stdout.take().ok_or_else(|| AppError::internal("AI stdout unavailable"))?;
    let mut stderr = child.stderr.take().ok_or_else(|| AppError::internal("AI stderr unavailable"))?;
    let stderr_task = tokio::spawn(async move {
        let mut bytes = Vec::new();
        let _ = stderr.read_to_end(&mut bytes).await;
        bytes
    });
    let mut lines = BufReader::new(stdout).lines();
    state
        .ai_chat_jobs
        .lock()
        .map_err(|_| AppError::internal("AI 취소 상태를 확인할 수 없습니다"))?
        .insert(request_id.clone(), crate::state::AiChatJob { pid, canceled: false, approvals: None });
    while let Some(line) = lines.next_line().await.map_err(|e| AppError::new("AI_FAILED", e.to_string()))? {
        if state
            .ai_chat_jobs
            .lock()
            .map_err(|_| AppError::internal("AI 취소 상태를 확인할 수 없습니다"))?
            .get(&request_id)
            .is_some_and(|job| job.canceled)
        {
            break;
        }
        if let Some(text) = stream_text(&line) {
            let _ = on_event.send(AiChatEvent::Chunk { text });
        } else if let Some(text) = stream_progress(&line) {
            let _ = on_event.send(AiChatEvent::Progress { text });
        }
    }
    let status = child.wait().await.map_err(|e| AppError::new("AI_FAILED", e.to_string()))?;
    let job = state
        .ai_chat_jobs
        .lock()
        .map_err(|_| AppError::internal("AI 취소 상태를 확인할 수 없습니다"))?
        .remove(&request_id);
    let canceled = job.is_some_and(|job| job.canceled);
    let stderr = stderr_task.await.unwrap_or_default();
    if canceled {
        return Ok(());
    }
    if !status.success() {
        return Err(AppError::new("AI_FAILED", String::from_utf8_lossy(&stderr).trim().to_string()));
    }
    let _ = on_event.send(AiChatEvent::Completed);
    Ok(())
}

async fn run_codex_app_server(
    state: State<'_, AppState>,
    request_id: String,
    request: AiChatRequest,
    on_event: Channel<AiChatEvent>,
) -> Result<(), AppError> {
    let mut child = Command::new("codex")
        .args(["app-server", "--listen", "stdio://"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| AppError::new("AI_UNAVAILABLE", format!("Codex app-server를 실행할 수 없습니다: {e}")))?;
    let pid = child
        .id()
        .and_then(|id| i32::try_from(id).ok())
        .ok_or_else(|| AppError::internal("Codex app-server 프로세스 id를 읽지 못했습니다"))?;
    let mut input = child.stdin.take().ok_or_else(|| AppError::internal("Codex stdin unavailable"))?;
    let stdout = child.stdout.take().ok_or_else(|| AppError::internal("Codex stdout unavailable"))?;
    let mut lines = BufReader::new(stdout).lines();
    let (approval_tx, mut approval_rx) = tokio::sync::mpsc::unbounded_channel::<serde_json::Value>();
    state
        .ai_chat_jobs
        .lock()
        .map_err(|_| AppError::internal("AI 취소 상태를 확인할 수 없습니다"))?
        .insert(request_id.clone(), crate::state::AiChatJob { pid, canceled: false, approvals: Some(approval_tx) });
    async fn send(input: &mut tokio::process::ChildStdin, value: serde_json::Value) -> Result<(), AppError> {
        use tokio::io::AsyncWriteExt;
        input.write_all(format!("{}\n", value).as_bytes()).await.map_err(|e| AppError::new("AI_FAILED", e.to_string()))?;
        input.flush().await.map_err(|e| AppError::new("AI_FAILED", e.to_string()))?;
        Ok(())
    }
    send(&mut input, serde_json::json!({"id":1,"method":"initialize","params":{"clientInfo":{"name":"dbpod","version":"0.1"}}})).await?;
    while let Some(line) = lines.next_line().await.map_err(|e| AppError::new("AI_FAILED", e.to_string()))? {
        if serde_json::from_str::<serde_json::Value>(&line).ok().and_then(|v| v.get("id").and_then(|id| id.as_i64())) == Some(1) {
            break;
        }
    }
    let model = if request.model == "default" { serde_json::Value::Null } else { serde_json::Value::String(request.model.clone()) };
    // Codex keeps the conversation in its own thread, so a follow-up resumes the
    // thread instead of restating what was already said.
    let start = match &request.session_id {
        Some(existing) => serde_json::json!({"id":2,"method":"thread/resume","params":{"threadId":existing,"cwd":".","approvalPolicy":"on-request","sandbox":"read-only"}}),
        None => serde_json::json!({"id":2,"method":"thread/start","params":{"model":model,"cwd":".","approvalPolicy":"on-request","sandbox":"read-only"}}),
    };
    send(&mut input, start).await?;
    let mut thread_id = None;
    while let Some(line) = lines.next_line().await.map_err(|e| AppError::new("AI_FAILED", e.to_string()))? {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
            if v.get("id").and_then(|id| id.as_i64()) == Some(2) {
                if let Some(message) = v.pointer("/error/message").and_then(|m| m.as_str()) {
                    return Err(AppError::new("AI_FAILED", format!("Codex 대화를 이어가지 못했습니다: {message}")));
                }
                thread_id = v.pointer("/result/thread/id").and_then(|id| id.as_str()).map(str::to_owned)
                    .or_else(|| request.session_id.clone());
                break;
            }
        }
    }
    let thread_id = thread_id.ok_or_else(|| AppError::new("AI_FAILED", "Codex thread를 시작하지 못했습니다"))?;
    let _ = on_event.send(AiChatEvent::Session { id: thread_id.clone() });
    let reasoning = if request.thinking == "auto" { serde_json::Value::Null } else { serde_json::Value::String(request.thinking.clone()) };
    send(&mut input, serde_json::json!({"id":3,"method":"turn/start","params":{"threadId":thread_id,"input":[{"type":"text","text":request.prompt}],"reasoningEffort":reasoning}})).await?;
    loop {
        // The turn blocks on an approval, so answers have to reach stdin while
        // the same task is still reading stdout.
        let line = tokio::select! {
            answer = approval_rx.recv() => match answer {
                Some(answer) => { send(&mut input, answer).await?; continue; }
                None => continue,
            },
            read = lines.next_line() => match read.map_err(|e| AppError::new("AI_FAILED", e.to_string()))? {
                Some(read) => read,
                None => break,
            },
        };
        if state
            .ai_chat_jobs
            .lock()
            .map_err(|_| AppError::internal("AI 취소 상태를 확인할 수 없습니다"))?
            .get(&request_id)
            .is_some_and(|job| job.canceled)
        {
            break;
        }
        let value: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        match value.get("method").and_then(|m| m.as_str()) {
            Some("item/agentMessage/delta") => {
                if let Some(text) = value.pointer("/params/delta").and_then(|v| v.as_str()) {
                    let _ = on_event.send(AiChatEvent::Chunk { text: text.into() });
                }
            }
            Some("turn/completed") | Some("turn/failed") => break,
            Some("item/started") => {
                let _ = on_event.send(AiChatEvent::Progress { text: "Codex 작업 중…".into() });
            }
            Some("mcpServer/elicitation/request") => {
                if let Some(approval_id) = value.get("id").and_then(|id| id.as_i64()) {
                    let _ = on_event.send(AiChatEvent::Approval {
                        approval_id,
                        message: value
                            .pointer("/params/message")
                            .and_then(|v| v.as_str())
                            .unwrap_or("도구 실행을 허용할까요?")
                            .to_string(),
                        detail: value
                            .pointer("/params/_meta/tool_description")
                            .and_then(|v| v.as_str())
                            .map(str::to_owned),
                    });
                }
            }
            _ => {}
        }
    }
    let job = state
        .ai_chat_jobs
        .lock()
        .map_err(|_| AppError::internal("AI 취소 상태를 확인할 수 없습니다"))?
        .remove(&request_id);
    if job.is_some_and(|job| job.canceled) {
        return Ok(());
    }
    let _ = on_event.send(AiChatEvent::Completed);
    // Closing stdin lets app-server exit on its own and release the thread's
    // writer lock; killing it strands the lock and the next turn cannot resume.
    drop(input);
    if tokio::time::timeout(std::time::Duration::from_secs(10), child.wait()).await.is_err() {
        let _ = child.kill().await;
    }
    Ok(())
}

fn stream_text(line: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    value.get("delta").and_then(|v| v.get("text")).and_then(|v| v.as_str()).map(str::to_owned)
        .or_else(|| value.get("item").and_then(|v| v.get("text")).and_then(|v| v.as_str()).map(str::to_owned))
        .or_else(|| value.get("content_block_delta").and_then(|v| v.get("delta")).and_then(|v| v.get("text")).and_then(|v| v.as_str()).map(str::to_owned))
        .or_else(|| value.get("item").and_then(|v| (v.get("type").and_then(|kind| kind.as_str()) == Some("agent_message")).then(|| v.get("text").and_then(|text| text.as_str()))).flatten().map(str::to_owned))
        .or_else(|| value.get("error").and_then(|v| v.get("message")).and_then(|v| v.as_str()).map(str::to_owned))
        .or_else(|| value.get("event").and_then(|event| event.get("delta")).and_then(|v| v.get("text")).and_then(|v| v.as_str()).map(str::to_owned))
}

fn stream_progress(line: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    match value.get("type").and_then(|v| v.as_str()) {
        Some("system") if value.get("subtype").and_then(|v| v.as_str()) == Some("hook_started") => Some(format!("준비 중: {}", value.get("hook_name").and_then(|v| v.as_str()).unwrap_or("작업"))),
        Some("system") if value.get("subtype").and_then(|v| v.as_str()) == Some("status") => Some("요청 처리 중…".into()),
        Some("stream_event") if value.pointer("/event/content_block_start/content_block/type").and_then(|v| v.as_str()) == Some("thinking") => Some("생각 중…".into()),
        Some("stream_event") if value.pointer("/event/content_block_start/content_block/type").and_then(|v| v.as_str()) == Some("tool_use") => Some("도구 실행 중…".into()),
        Some("item.started") | Some("turn.started") => Some("작업 중…".into()),
        _ => None,
    }
}

#[tauri::command]
pub fn vault_status() -> VaultStatus {
    connection_service::vault_status()
}

#[tauri::command]
pub fn connection_profile_list(state: State<'_, AppState>) -> Vec<ConnectionProfile> {
    connection_service::profile_list(&state)
}

#[tauri::command]
pub fn connection_profile_reorder(
    state: State<'_, AppState>,
    profile_ids: Vec<String>,
) -> Result<(), AppError> {
    connection_service::profile_reorder(&state, &profile_ids)
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
pub async fn connection_switch_database(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
) -> Result<ConnectionOpenResponse, AppError> {
    connection_service::connection_switch_database(&state, &connection_id, &database).await
}

#[tauri::command]
pub async fn connection_reconnect(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<ConnectionOpenResponse, AppError> {
    connection_service::connection_reconnect(&state, &connection_id).await
}

#[tauri::command]
pub async fn metadata_list_databases(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<Vec<crate::domain::metadata::DatabaseInfo>, AppError> {
    crate::application::metadata_service::list_databases(&state, &connection_id).await
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
pub async fn metadata_drop_object(
    state: State<'_, AppState>,
    request: crate::domain::metadata::MetadataDropObjectRequest,
) -> Result<(), AppError> {
    crate::application::metadata_service::drop_object(&state, &request).await
}

#[tauri::command]
pub async fn metadata_get_routine_definition(
    state: State<'_, AppState>,
    connection_id: String,
    routine_oid: u32,
) -> Result<String, AppError> {
    crate::application::metadata_service::get_routine_definition(
        &state,
        &connection_id,
        routine_oid,
    )
    .await
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
    query_service::execute_with_paging(&state, request, sink, true)
}

#[tauri::command]
pub fn result_rows_fetch(
    state: State<'_, AppState>,
    request: ResultRowsFetchRequest,
) -> Result<ResultRowsFetchResponse, AppError> {
    query_service::result_rows_fetch(&state, &request)
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
