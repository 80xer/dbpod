// AUTO-GENERATED from src-tauri Rust types by `cargo test --test export_bindings`.
// Do not edit by hand.

export type AppError = { code: string, message: string, retryable: boolean, sqlState: string | null, position: number | null, detail: string | null, hint: string | null, };

export type TlsMode = "verify-full" | "verify-ca" | "insecure";

export type Environment = "local" | "dev" | "stage" | "prod";

export type ConnectionProfile = { id: string, name: string, environment: Environment, color: string | null, host: string, port: number, database: string, username: string, tlsMode: TlsMode, readOnly: boolean, queryTimeoutMs: number, maxRows: number, hasStoredCredential: boolean, };

export type ProfileDraft = { id: string | null, name: string, environment: Environment, color: string | null, host: string, port: number, database: string, username: string, tlsMode: TlsMode, readOnly: boolean, queryTimeoutMs: number, maxRows: number, };

export type SecretInput = { "mode": "keep-existing" } | { "mode": "replace", password: string, } | { "mode": "prompt-each-time" };

export type ConnectionProfileSaveRequest = { profile: ProfileDraft, secret: SecretInput, };

export type ConnectionProfileSaveResponse = { profileId: string, };

export type ConnectionTestRequest = { profileId: string | null, draft: ProfileDraft | null, password: string | null, };

export type TlsStatus = { enabled: boolean, mode: string, };

export type ConnectionTestResult = { serverVersion: string, latencyMs: number, tls: TlsStatus, currentUser: string, database: string, isSuperuser: boolean, };

export type ConnectionOpenRequest = { profileId: string, };

export type ConnectionOpenResponse = { connectionId: string, profileId: string, serverVersion: string, };

export type ConnectionCloseRequest = { connectionId: string, };

export type VaultStatus = { state: string, secureStorageAvailable: boolean, };

export type DbValue = { "t": "null" } | { "t": "bool", "v": boolean } | { "t": "int", "v": number } | { "t": "float", "v": number } | { "t": "numeric", "v": string } | { "t": "text", "v": string } | { "t": "timestamp", "v": string } | { "t": "uuid", "v": string } | { "t": "json", "v": string } | { "t": "fallback", "v": string };

export type ColumnMeta = { index: number, name: string, typeOid: number, typeName: string, };

export type TransactionState = "idle" | "in-transaction" | "failed-transaction";

export type QueryStreamEvent = { "type": "started", executionId: string, backendPid: number, startedAt: string, } | { "type": "columns", executionId: string, columns: Array<ColumnMeta>, } | { "type": "rows", executionId: string, sequence: number, rows: Array<Array<DbValue>>, } | { "type": "notice", executionId: string, severity: string, message: string, } | { "type": "command", executionId: string, commandTag: string, affectedRows: number | null, } | { "type": "completed", executionId: string, rowCount: number, truncated: boolean, durationMs: number, transactionState: TransactionState, } | { "type": "failed", executionId: string, error: AppError, durationMs: number, transactionState: TransactionState, } | { "type": "cancelled", executionId: string, receivedRowCount: number, durationMs: number, transactionState: TransactionState, };

export type QuerySessionOpenRequest = { connectionId: string, queryTabId: string, };

export type QuerySessionOpenResponse = { sessionId: string, };

export type QuerySessionCloseRequest = { sessionId: string, rollbackOpenTransaction: boolean, };

export type QueryExecuteRequest = { connectionId: string, queryTabId: string, resultTabId: string, sql: string, maxRows: number, timeoutMs: number, };

export type ExecutionAccepted = { executionId: string, sessionId: string, };

export type QueryAckChunkRequest = { executionId: string, sequence: number, };

export type QueryCancelRequest = { executionId: string, };

export type QueryCancelResponse = { 
/**
 * "cancel-requested" | "already-terminal"
 */
state: string, };

