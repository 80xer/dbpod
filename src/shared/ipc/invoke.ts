import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  ChangesCommitEvent,
  ChangesCommitRequest,
  ChangesDiscardRequest,
  ChangesPreviewRequest,
  ChangesPreviewResponse,
  ConnectionCloseRequest,
  ConnectionOpenRequest,
  ConnectionOpenResponse,
  ConnectionProfile,
  ConnectionProfileSaveRequest,
  ConnectionProfileSaveResponse,
  ConnectionTestRequest,
  ConnectionTestResult,
  DatabaseObjectSummary,
  DatabaseInfo,
  ExecutionAccepted,
  MetadataGetTableRequest,
  MetadataDropObjectRequest,
  MetadataListObjectsRequest,
  MetadataListSchemasRequest,
  AiChatCancelRequest,
  QueryAckChunkRequest,
  QueryCancelRequest,
  QueryCancelResponse,
  QueryExecuteRequest,
  QuerySessionCloseRequest,
  QueryStreamEvent,
  ResultReleaseRequest,
  ResultRowsFetchRequest,
  ResultRowsFetchResponse,
  ResultValueFetchRequest,
  ResultValueFetchResponse,
  SchemaInfo,
  TableDataExecuteRequest,
  TableMetadata,
  AiChatEvent,
  AiChatRequest,
  VaultStatus,
  WorkspaceSnapshot,
} from "../../generated/ipc-types";

export const ipc = {
  aiChat: (request: AiChatRequest, onEvent: Channel<AiChatEvent>) => invoke<string>("ai_chat", { request, onEvent }),
  aiChatCancel: (request: AiChatCancelRequest) => invoke<boolean>("ai_chat_cancel", { request }),
  vaultStatus: () => invoke<VaultStatus>("vault_status"),
  profileList: () => invoke<ConnectionProfile[]>("connection_profile_list"),
  profileReorder: (profileIds: string[]) =>
    invoke<void>("connection_profile_reorder", { profileIds }),
  profileSave: (request: ConnectionProfileSaveRequest) =>
    invoke<ConnectionProfileSaveResponse>("connection_profile_save", { request }),
  profileDelete: (profileId: string) =>
    invoke<void>("connection_profile_delete", { profileId }),
  connectionTest: (request: ConnectionTestRequest) =>
    invoke<ConnectionTestResult>("connection_test", { request }),
  connectionOpen: (request: ConnectionOpenRequest) =>
    invoke<ConnectionOpenResponse>("connection_open", { request }),
  connectionSwitchDatabase: (args: { connectionId: string; database: string }) =>
    invoke<ConnectionOpenResponse>("connection_switch_database", args),
  metadataListDatabases: (connectionId: string) =>
    invoke<DatabaseInfo[]>("metadata_list_databases", { connectionId }),
  connectionClose: (request: ConnectionCloseRequest) =>
    invoke<void>("connection_close", { request }),
  querySessionClose: (request: QuerySessionCloseRequest) =>
    invoke<void>("query_session_close", { request }),
  queryExecute: (request: QueryExecuteRequest, onEvent: Channel<QueryStreamEvent>) =>
    invoke<ExecutionAccepted>("query_execute", { request, onEvent }),
  queryAckChunk: (request: QueryAckChunkRequest) =>
    invoke<void>("query_ack_chunk", { request }),
  queryCancel: (request: QueryCancelRequest) =>
    invoke<QueryCancelResponse>("query_cancel", { request }),
  resultValueFetch: (request: ResultValueFetchRequest) =>
    invoke<ResultValueFetchResponse>("result_value_fetch", { request }),
  resultRowsFetch: (request: ResultRowsFetchRequest) =>
    invoke<ResultRowsFetchResponse>("result_rows_fetch", { request }),
  resultRelease: (request: ResultReleaseRequest) =>
    invoke<void>("result_release", { request }),
  metadataListSchemas: (request: MetadataListSchemasRequest) =>
    invoke<SchemaInfo[]>("metadata_list_schemas", { request }),
  metadataListObjects: (request: MetadataListObjectsRequest) =>
    invoke<DatabaseObjectSummary[]>("metadata_list_objects", { request }),
  metadataDropObject: (request: MetadataDropObjectRequest) =>
    invoke<void>("metadata_drop_object", { request }),
  metadataGetTable: (request: MetadataGetTableRequest) =>
    invoke<TableMetadata>("metadata_get_table", { request }),
  metadataGetRoutineDefinition: (args: { connectionId: string; routineOid: number }) =>
    invoke<string>("metadata_get_routine_definition", args),
  tableDataExecute: (request: TableDataExecuteRequest, onEvent: Channel<QueryStreamEvent>) =>
    invoke<ExecutionAccepted>("table_data_execute", { request, onEvent }),
  changesPreview: (request: ChangesPreviewRequest) =>
    invoke<ChangesPreviewResponse>("changes_preview", { request }),
  changesCommit: (request: ChangesCommitRequest, onEvent: Channel<ChangesCommitEvent>) =>
    invoke<void>("changes_commit", { request, onEvent }),
  changesDiscard: (request: ChangesDiscardRequest) =>
    invoke<void>("changes_discard", { request }),
  exportSave: (request: { suggestedName: string; content: string }) =>
    invoke<boolean>("export_save", { request }),
  workspaceSnapshotLoad: () => invoke<WorkspaceSnapshot | null>("workspace_snapshot_load"),
  workspaceSnapshotSave: (snapshot: WorkspaceSnapshot) =>
    invoke<void>("workspace_snapshot_save", { snapshot }),
};
