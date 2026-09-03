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
  ExecutionAccepted,
  QueryAckChunkRequest,
  QueryCancelRequest,
  QueryCancelResponse,
  QueryExecuteRequest,
  QuerySessionCloseRequest,
  QueryStreamEvent,
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
};
