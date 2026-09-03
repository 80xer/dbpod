import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  ConnectionCloseRequest,
  ConnectionOpenRequest,
  ConnectionOpenResponse,
  ConnectionProfile,
  ConnectionProfileSaveRequest,
  ConnectionProfileSaveResponse,
  ConnectionTestRequest,
  ConnectionTestResult,
  DatabaseObjectSummary,
  ExecutionAccepted,
  MetadataGetTableRequest,
  MetadataListObjectsRequest,
  MetadataListSchemasRequest,
  QueryAckChunkRequest,
  QueryCancelRequest,
  QueryCancelResponse,
  QueryExecuteRequest,
  QuerySessionCloseRequest,
  QueryStreamEvent,
  ResultReleaseRequest,
  ResultValueFetchRequest,
  ResultValueFetchResponse,
  SchemaInfo,
  TableDataExecuteRequest,
  TableMetadata,
  VaultStatus,
} from "../../generated/ipc-types";

export const ipc = {
  vaultStatus: () => invoke<VaultStatus>("vault_status"),
  profileList: () => invoke<ConnectionProfile[]>("connection_profile_list"),
  profileSave: (request: ConnectionProfileSaveRequest) =>
    invoke<ConnectionProfileSaveResponse>("connection_profile_save", { request }),
  profileDelete: (profileId: string) =>
    invoke<void>("connection_profile_delete", { profileId }),
  connectionTest: (request: ConnectionTestRequest) =>
    invoke<ConnectionTestResult>("connection_test", { request }),
  connectionOpen: (request: ConnectionOpenRequest) =>
    invoke<ConnectionOpenResponse>("connection_open", { request }),
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
  resultRelease: (request: ResultReleaseRequest) =>
    invoke<void>("result_release", { request }),
  metadataListSchemas: (request: MetadataListSchemasRequest) =>
    invoke<SchemaInfo[]>("metadata_list_schemas", { request }),
  metadataListObjects: (request: MetadataListObjectsRequest) =>
    invoke<DatabaseObjectSummary[]>("metadata_list_objects", { request }),
  metadataGetTable: (request: MetadataGetTableRequest) =>
    invoke<TableMetadata>("metadata_get_table", { request }),
  tableDataExecute: (request: TableDataExecuteRequest, onEvent: Channel<QueryStreamEvent>) =>
    invoke<ExecutionAccepted>("table_data_execute", { request, onEvent }),
};
