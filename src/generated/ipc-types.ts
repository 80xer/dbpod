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

export type ConnectionOpenRequest = { profileId: string, password: string | null, };

export type ConnectionOpenResponse = { connectionId: string, profileId: string, database: string, serverVersion: string, };

export type ConnectionCloseRequest = { connectionId: string, };

export type VaultStatus = { state: string, secureStorageAvailable: boolean, };

export type TemporalType = "date" | "time" | "timetz" | "timestamp" | "timestamptz" | "interval";

export type JsonType = "json" | "jsonb";

export type ArrayDimension = { lowerBound: number, length: number, };

export type DbValue = { "kind": "null" } | { "kind": "boolean", value: boolean, } | { "kind": "integer", value: string, } | { "kind": "decimal", value: string, } | { "kind": "float", value: string, } | { "kind": "text", value: string, } | { "kind": "uuid", value: string, } | { "kind": "temporal", temporalType: TemporalType, value: string, } | { "kind": "json", value: string, jsonType: JsonType, } | { "kind": "binary", encoding: string, value: string | null, byteLength: number, truncated: boolean, valueHandle: string | null, } | { "kind": "array", dimensions: Array<ArrayDimension>, values: Array<DbValue>, elementTypeOid: number, } | { "kind": "enum", value: string, typeName: string, } | { "kind": "network", value: string, networkType: string, } | { "kind": "range", value: string, rangeType: string, } | { "kind": "composite", value: string, typeName: string, } | { "kind": "unknown", value: string, typeOid: number, typeName: string, };

export type ColumnCategory = "boolean" | "integer" | "decimal" | "float" | "text" | "binary" | "uuid" | "temporal" | "json" | "array" | "enum" | "network" | "range" | "composite" | "unknown";

export type ColumnSource = { relationOid: number, attributeNumber: number, };

export type ColumnMeta = { index: number, name: string, pgTypeOid: number, pgTypeName: string, category: ColumnCategory, source: ColumnSource | null, nullable: boolean | null, 
/**
 * Conservative default until editability detection lands (Milestone C).
 */
editable: boolean, };

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

export type ResultValueFetchRequest = { resultTabId: string, valueHandle: string, offset: number, length: number, };

export type ResultValueFetchResponse = { 
/**
 * base64 of the requested byte range
 */
data: string, eof: boolean, };

export type ResultReleaseRequest = { resultTabId: string, };

export type ResultRowsFetchRequest = { resultTabId: string, executionId: string, offset: number, };

export type ResultRowsFetchResponse = { rows: Array<Array<DbValue>>, nextOffset: number, hasMore: boolean, };

export type MetadataListSchemasRequest = { connectionId: string, includeSystem: boolean, };

export type DatabaseInfo = { name: string, canConnect: boolean, };

export type SchemaInfo = { oid: number, name: string, isSystem: boolean, };

export type ObjectKind = "table" | "view" | "materialized-view" | "function" | "sequence";

export type MetadataListObjectsRequest = { connectionId: string, schemaOids: Array<number>, kinds: Array<ObjectKind>, };

export type MetadataDropObjectRequest = { connectionId: string, objectOid: number, kind: ObjectKind, };

export type DatabaseObjectSummary = { oid: number, schema: string, name: string, kind: ObjectKind, functionArguments?: string, partitionParentOid: number | null, canSelect: boolean | null, canInsert: boolean | null, canUpdate: boolean | null, canDelete: boolean | null, };

export type MetadataGetTableRequest = { connectionId: string, relationOid: number, };

export type TableColumnMetadata = { attributeNumber: number, name: string, pgTypeOid: number, pgTypeName: string, nullable: boolean, defaultExpr: string | null, comment: string | null, isGenerated: boolean, isPrimaryKey: boolean, };

export type TableMetadata = { relationOid: number, schema: string, name: string, 
/**
 * 'table' | 'partitioned-table' | 'view' | 'materialized-view'
 */
kind: string, columns: Array<TableColumnMetadata>, 
/**
 * attribute numbers of the primary key, in key order
 */
primaryKey: Array<number>, uniqueKeys: Array<Array<number>>, rowLevelSecurity: boolean, };

export type TableDataExecuteRequest = { connectionId: string, queryTabId: string, resultTabId: string, relationOid: number, 
/**
 * attribute number to sort by (validated against the catalog)
 */
sortAttribute: number | null, sortDescending: boolean, limit: number, offset: number, };

export type TabSnapshot = { title: string, sql: string, id: string | null, };

export type ConnectionSnapshot = { profileId: string, database: string | null, activeTabIndex: number | null, tabs: Array<TabSnapshot>, tabGroups: Array<TabGroupSnapshot>, };

export type WorkspaceSnapshot = { version: number, connections: Array<ConnectionSnapshot>, };

export type InsertCellDraft = { "mode": "value", value: DbValue, } | { "mode": "null" } | { "mode": "default" };

export type PrimaryKeyValue = { attributeNumber: number, columnName: string, value: DbValue, };

export type RowIdentity = { relationOid: number, primaryKey: Array<PrimaryKeyValue>, xmin: string | null, };

export type RowChange = { "operation": "update", rowId: string, identity: RowIdentity, originalValues: { [key in string]: DbValue }, changes: { [key in string]: DbValue }, } | { "operation": "insert", rowId: string, values: { [key in string]: InsertCellDraft }, } | { "operation": "delete", rowId: string, identity: RowIdentity, originalValues: { [key in string]: DbValue }, };

export type ChangesPreviewRequest = { connectionId: string, resultTabId: string, relationOid: number, changes: Array<RowChange>, };

export type ChangeTarget = { schema: string, table: string, };

export type ChangeCounts = { insert: number, update: number, delete: number, };

export type StatementPreview = { 
/**
 * "insert" | "update" | "delete"
 */
operation: string, sqlTemplate: string, parameterTypes: Array<string>, rowCount: number, };

export type ChangesPreviewResponse = { changeSetId: string, expiresAt: string, target: ChangeTarget, counts: ChangeCounts, statements: Array<StatementPreview>, warnings: Array<string>, };

export type ChangesCommitRequest = { changeSetId: string, };

export type ChangesDiscardRequest = { changeSetId: string, };

export type UpdatedRow = { rowId: string, 
/**
 * "insert" | "update" | "delete"
 */
operation: string, 
/**
 * Authoritative server-returned values by column name (empty for delete).
 */
values: { [key in string]: DbValue }, xmin: string | null, };

export type RowConflict = { rowId: string, reason: string, 
/**
 * Latest server values by column name; None when the row no longer exists.
 */
current: { [key in string]: DbValue } | null, };

export type ChangesCommitEvent = { "type": "started", totalRows: number, } | { "type": "progress", completedRows: number, } | { "type": "completed", rows: Array<UpdatedRow>, } | { "type": "conflict", conflicts: Array<RowConflict>, } | { "type": "failed", error: AppError, };

