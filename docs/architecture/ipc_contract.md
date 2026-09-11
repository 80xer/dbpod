# DBPod Tauri IPC 계약

- 상태: MVP 기준선
- 최종 수정일: 2026-07-27
- Source of truth: Rust `serde` types

## 1. 목적

React WebView가 호출할 수 있는 Tauri command, Channel event, 요청·응답·오류, 권한과 민감정보 규칙을 정의한다.

## 2. 공통 규칙

- command 이름은 `snake_case`를 사용한다.
- JavaScript argument key는 `camelCase`를 사용한다.
- Rust type에서 TypeScript binding을 생성한다.
- 모든 ID는 opaque UUID 문자열이다.
- frontend가 보낸 ID는 Rust registry와 invoking webview ownership을 검증한다.
- async command는 borrowed secret을 유지하지 않고 owned request를 받는다.
- command argument와 result를 debug log에 자동 출력하지 않는다.
- 목록 command는 pagination 또는 상한을 가진다.
- streaming은 Tauri Channel을 사용한다.
- global event bus로 Query Result를 전달하지 않는다.

## 3. 공통 type

```ts
type OpaqueId = string

type PageRequest = {
  cursor?: string
  limit: number
}

type Page<T> = {
  items: T[]
  nextCursor?: string
}

type RequestContext = {
  requestId: string
}

type AppError = {
  code: string
  message: string
  retryable: boolean
  sqlState?: string
  position?: number
  severity?: string
  detail?: string
  hint?: string
  context?: Record<string, string>
}
```

`message`, `detail`, `hint`는 server가 제공한 안전한 text만 포함하고 secret과 전체 row value는 포함하지 않는다.

## 4. Capability

논리 permission group:

| Permission | 대상 |
| --- | --- |
| `dbpod:vault-read` | vault 상태 |
| `dbpod:vault-write` | unlock, lock, secret 저장/삭제 |
| `dbpod:connections-read` | profile 목록과 상태 |
| `dbpod:connections-write` | profile 저장/삭제, open/close |
| `dbpod:metadata-read` | schema/object/table metadata |
| `dbpod:query-execute` | session과 arbitrary query |
| `dbpod:query-cancel` | execution 취소 |
| `dbpod:result-read` | 큰 cell fetch/release |
| `dbpod:data-write` | Preview/Commit/Discard |
| `dbpod:history-read` | History 조회 |
| `dbpod:history-write` | History 삭제와 설정 |
| `dbpod:settings` | 비민감 설정 |

규칙:

- `main` local webview만 권한을 가진다.
- remote URL capability는 없다.
- settings/about 같은 별도 webview를 추가할 경우 query와 data-write 권한을 주지 않는다.
- command 내부에서도 permission에 의존하지 않고 object ownership을 다시 확인한다.

## 5. Vault command

### 5.1 `vault_status`

Permission: `dbpod:vault-read`

Response:

```ts
type VaultStatus = {
  state: 'uninitialized' | 'locked' | 'unlocked'
  autoLockMinutes: number
  secureStorageAvailable: boolean
}
```

### 5.2 `vault_initialize`

Permission: `dbpod:vault-write`

Request:

```ts
type VaultInitializeRequest = {
  context: RequestContext
  masterPassword?: string
}
```

OS secure storage를 사용할 수 없을 때만 master password가 필수다. request는 loggable trait/derive를 구현하지 않는다.

### 5.3 `vault_unlock`

Permission: `dbpod:vault-write`

```ts
type VaultUnlockRequest = {
  context: RequestContext
  masterPassword?: string
  useBiometric?: boolean
}
```

Response:

```ts
type VaultUnlockResponse = {
  unlocked: true
  expiresAt?: string
}
```

### 5.4 `vault_lock`

Permission: `dbpod:vault-write`

동작:

- decrypted credential cache zeroize
- secret command 차단
- UI에 lock state 전달
- active session 종료 여부는 사용자 설정 적용

## 6. Connection Profile

### 6.1 `connection_profile_list`

Permission: `dbpod:connections-read`

Response:

```ts
type ConnectionProfileSummary = {
  id: string
  name: string
  environment: 'local' | 'dev' | 'stage' | 'prod'
  color?: string
  host: string
  port: number
  database: string
  username: string
  tlsMode: 'verify-full' | 'verify-ca' | 'insecure'
  readOnly: boolean
  hasStoredCredential: boolean
}
```

### 6.2 `connection_profile_save`

Permission: `dbpod:connections-write`, `dbpod:vault-write`

```ts
type SecretInput =
  | { mode: 'keep-existing' }
  | { mode: 'replace'; password: string }
  | { mode: 'prompt-each-time' }

type ConnectionProfileSaveRequest = {
  context: RequestContext
  profile: {
    id?: string
    name: string
    environment: 'local' | 'dev' | 'stage' | 'prod'
    color?: string
    host: string
    port: number
    database: string
    username: string
    tlsMode: 'verify-full' | 'verify-ca' | 'insecure'
    caCertificateRef?: string
    clientCertificateRef?: string
    readOnly: boolean
    queryTimeoutMs: number
    maxRows: number
  }
  secret: SecretInput
}
```

Response:

```ts
type ConnectionProfileSaveResponse = {
  profileId: string
}
```

password는 vault 저장 직후 request memory에서 제거 가능한 범위까지 zeroize한다. 응답에 credential ID나 password를 노출하지 않는다.

### 6.3 `connection_profile_delete`

```ts
type ConnectionProfileDeleteRequest = {
  context: RequestContext
  profileId: string
  deleteHistory: boolean
  deleteDrafts: boolean
}
```

open workspace가 있으면 먼저 안전 종료가 필요하다.

### 6.4 `connection_test`

Permission: `dbpod:connections-write`

저장 전 profile과 one-time secret 또는 저장된 profile ID를 사용한다.

Response:

```ts
type ConnectionTestResult = {
  serverVersion: string
  latencyMs: number
  tls: {
    enabled: boolean
    mode: string
    protocol?: string
    peerNameVerified: boolean
  }
  currentUser: string
  database: string
  isSuperuser: boolean
}
```

### 6.5 `connection_open`

```ts
type ConnectionOpenRequest = {
  context: RequestContext
  profileId: string
  password: string | null
}

type ConnectionOpenResponse = {
  connectionId: string
  profileId: string
  status: 'connected'
  serverVersion: string
  capabilities: {
    canReadMetadata: boolean
    canWrite: boolean
    supportsCancel: boolean
  }
}
```

### 6.6 `connection_close`

```ts
type ConnectionCloseRequest = {
  context: RequestContext
  connectionId: string
  rollbackOpenTransactions: boolean
}
```

dirty UI edit는 frontend가 먼저 처리하고 Rust는 open transaction 존재 시 강제 확인 flag 없이 닫지 않는다.

### 6.7 `connection_status`

Response:

```ts
type ConnectionStatus = {
  connectionId: string
  state: 'connected' | 'reconnecting' | 'disconnected' | 'error'
  latencyMs?: number
  openQuerySessions: number
  runningExecutions: number
}
```

### 6.8 `connection_profile_reorder` (현재 구현)

인자: `{ profileIds: string[] }`, 응답: `void`.

현재 프로필 ID를 원하는 표시 순서대로 모두 한 번씩 전달한다. 누락·중복·알 수 없는 ID는 `INVALID_REQUEST`로 거부한다. Rust가 `profiles.json` 배열 순서를 atomic rename으로 저장하며, 쓰기에 실패하면 메모리 순서도 복원한다. 목록 조회는 이 순서를 그대로 반환한다. 새 프로필은 마지막에 추가하고 기존 프로필 편집은 위치를 유지한다. 순서 변경은 자격 증명을 읽거나 수정하지 않는다.

UI는 HTML drag-and-drop을 사용한다. Tauri 창의 `dragDropEnabled: false`는 네이티브 파일 드롭 처리 대신 웹 드래그 이벤트를 사용하기 위한 설정이다.

### 6.9 `connection_switch_database` (현재 구현)

인자: `{ connectionId: string; database: string }`, 응답: `ConnectionOpenResponse`.

열린 연결의 호스트·사용자·TLS·일회용 자격 증명을 Rust 메모리에서 재사용하고 대상 DB 연결을 먼저 확인한다. 동일한 `connectionId`의 현재 DB를 교체하고 이전 세션·결과·편집 미리보기를 정리한다. 쿼리 실행·트랜잭션이 남아 있으면 `CONNECTION_BUSY`로 차단한다. 실패 시 기존 연결과 결과를 보존하며 저장된 프로필의 기본 DB도 변경하지 않는다. 새 연결 항목을 만들지 않고, 다시 연결할 때도 프로필당 기존 연결을 재사용한다. 연결 응답의 `database`는 실제 현재 DB 이름이다.

UI는 초안 저장 성공 후 전환하며 이전 DB의 결과·테이블 탭·메타데이터 캐시를 정리하고 대상 DB의 SQL 초안을 복원한다. 대기 중인 메타데이터 요청과 편집 저장도 DB 일치 여부를 확인해 이전 DB의 작업이 새 DB에 적용되지 않도록 한다.

## 7. Certificate import

### `credential_import_certificate`

Permission: `dbpod:vault-write`

Rust가 native file picker를 열어 사용자가 선택한 파일을 읽고 검증한다.

```ts
type CertificateImportRequest = {
  context: RequestContext
  kind: 'ca' | 'client-certificate' | 'client-private-key'
}

type CertificateImportResponse = {
  certificateRef: string
  subject?: string
  issuer?: string
  expiresAt?: string
}
```

private key path와 내용은 frontend에 반환하지 않는다.

## 8. Metadata

### `metadata_list_databases` (현재 구현)

인자: `{ connectionId: string }`, 응답: `Array<{ name: string; canConnect: boolean }>`.

`pg_database`의 전체 목록을 이름순으로 반환한다. `canConnect`는 DB의 연결 허용 상태와 현재 사용자의 CONNECT 권한을 반영한다. 실제 전환 시 인증·서버 연결 제한은 PostgreSQL이 최종 검사한다.

### 8.1 `metadata_list_schemas`

Permission: `dbpod:metadata-read`

```ts
type MetadataListSchemasRequest = {
  connectionId: string
  includeSystem: boolean
}

type SchemaInfo = {
  oid: number
  name: string
  isSystem: boolean
}
```

### 8.2 `metadata_list_objects`

```ts
type MetadataListObjectsRequest = {
  connectionId: string
  schemaOids: number[]
  kinds: Array<'table' | 'view' | 'materialized-view' | 'function' | 'sequence'>
  page: PageRequest
}

type DatabaseObjectSummary = {
  oid: number
  schema: string
  name: string
  kind: string
  partitionParentOid: number | null
  functionArguments?: string
  canSelect?: boolean
  canInsert?: boolean
  canUpdate?: boolean
  canDelete?: boolean
}
```

현재 구현은 최상위 테이블·뷰 최대 1,000개와 그 파티션 계층을 함께 반환한다. `partitionParentOid`는 직계 부모 OID이며 일반 테이블·뷰·함수는 `null`이다. 파티션은 부모 아래에만 나타나고, 다른 스키마의 파티션도 부모 응답에 포함된다. 일반 `INHERITS` 테이블은 독립 객체로 유지한다. 탐색기는 기본적으로 파티션을 접고, 검색 시 일치하는 자식과 부모 경로를 함께 표시한다.

스키마 아래 `Tables`·`Functions` 폴더를 따로 두고 펼칠 때 해당 종류만 조회한다. `Functions`는 일반·윈도 함수와 프로시저를 반환하고 `functionArguments`에 식별용 인자 목록을 담아 오버로드를 구분한다. 함수·프로시저를 클릭하면 읽기 전용 정의 코드 탭을 열며 같은 OID의 열린 탭을 재사용한다.

### 8.3 `metadata_get_table`

Response:

```ts
type TableMetadata = {
  relationOid: number
  schema: string
  name: string
  kind: 'table' | 'partitioned-table' | 'view' | 'materialized-view'
  columns: TableColumnMetadata[]
  primaryKey: number[]
  uniqueKeys: number[][]
  rowLevelSecurity: boolean
}
```

### 8.4 `metadata_get_routine_definition`

```ts
// IPC 최상위 인자
type MetadataGetRoutineDefinitionArgs = {
  connectionId: string
  routineOid: number
}

type MetadataGetRoutineDefinitionResponse = string
```

현재 연결 DB의 `pg_proc`에서 OID로 함수·윈도 함수·프로시저를 찾아 `pg_get_functiondef` 결과를 반환한다. 해당 객체가 없으면 오류를 반환한다. UI는 정의 SQL을 읽기 전용으로 표시하고 새로고침·실패 시 재시도를 제공한다. DB 전환 시 정의 탭과 조회 캐시를 정리한다.

## 9. Query session

### 9.1 `query_session_open`

Permission: `dbpod:query-execute`

```ts
type QuerySessionOpenRequest = {
  context: RequestContext
  connectionId: string
  queryTabId: string
}

type QuerySessionOpenResponse = {
  sessionId: string
  transactionState: 'idle'
}
```

idempotent: 같은 queryTabId session이 있으면 기존 session을 반환한다.

### 9.2 `query_session_close`

```ts
type QuerySessionCloseRequest = {
  context: RequestContext
  sessionId: string
  rollbackOpenTransaction: boolean
}
```

### 9.3 `query_session_rollback`

열린 또는 failed transaction을 명시적으로 rollback한다.

## 10. Query execution

### 10.1 `query_execute`

Permission: `dbpod:query-execute`

입력:

- `QueryExecuteRequest`
- `Channel<QueryStreamEvent>`

응답:

- `ExecutionAccepted`

상세 type과 ordering은 [`../spec/query_execution_spec.md`](../spec/query_execution_spec.md)를 따른다.

검증:

- session과 Query Tab ownership
- Result Tab ID format
- SQL byte length
- 한 session의 active execution
- timeout 범위 (maxRows는 쿼리 페이지 조회에 미적용)
- connection state

### 10.2 `query_ack_chunk`

Permission: `dbpod:query-execute`

```ts
type QueryAckChunkRequest = {
  executionId: string
  sequence: number
}
```

중복 ack는 idempotent다. 미래 sequence ack는 protocol error다.

### 10.3 `query_cancel`

Permission: `dbpod:query-cancel`

```ts
type QueryCancelRequest = {
  context: RequestContext
  executionId: string
}

type QueryCancelResponse = {
  state: 'cancel-requested' | 'already-terminal'
}
```

### 10.4 `query_session_force_close`

취소가 terminal로 전환되지 않을 때만 UI에서 노출한다.

```ts
type QuerySessionForceCloseRequest = {
  context: RequestContext
  sessionId: string
}
```

다른 session은 닫지 않는다.

## 11. Result retrieval

### 11.1 `result_value_fetch`

Permission: `dbpod:result-read`

```ts
type ResultValueFetchRequest = {
  resultTabId: string
  valueHandle: string
  offset: number
  length: number
}
```

- binary는 optimized raw IPC response 사용 가능
- text는 UTF-8 경계를 보존
- 한 request 최대 1MiB
- Result Tab 닫힌 뒤 handle은 무효

### 11.2 `result_release`

```ts
type ResultReleaseRequest = {
  resultTabId: string
}
```

frontend dispose와 Rust의 보관 결과·value handle을 함께 정리한다.

### 11.3 `result_rows_fetch`

```ts
type ResultRowsFetchRequest = {
  resultTabId: string
  executionId: string
  offset: number
}

type ResultRowsFetchResponse = {
  rows: DbValue[][]
  nextOffset: number
  hasMore: boolean
}
```

`query_execute`는 처음 200행만 Channel로 전송하고, 메모리 예산 범위의 나머지 행을 Rust에 보관한다. 고정 행 수 제한은 없으며, 호환용 `maxRows` 필드와 기존 프로필의 500행 설정은 적용하지 않는다. SQL은 한 번 실행하며 서버의 최종 성공·실패 확인까지 결과를 소비한다. UI는 terminal 이벤트의 `rowCount`가 표시한 행 수보다 많으면 스크롤 끝 근처에서 이 명령으로 최대 200행씩 가져온다. 넓은 행은 1MiB 전송 한도를 우선한다. `offset`은 보관 결과의 위치이며, UI에서 행을 삭제해도 다음 조회 위치는 바뀌지 않는다. 교체된 `executionId`, 닫힌 결과, 범위 밖 offset은 거부한다. 전체 복사·내보내기도 같은 보관 결과를 읽으며 SQL을 재실행하지 않는다.

## 12. Data editing

### 12.1 `changes_preview`

Permission: `dbpod:data-write`

```ts
type ChangesPreviewRequest = {
  context: RequestContext
  connectionId: string
  resultTabId: string
  changes: RowChange[]
}

type ChangesPreviewResponse = {
  changeSetId: string
  expiresAt: string
  target: { schema: string; table: string }
  counts: { insert: number; update: number; delete: number }
  statements: Array<{
    operation: 'insert' | 'update' | 'delete'
    sqlTemplate: string
    parameterTypes: string[]
    rowCount: number
  }>
  warnings: string[]
}
```

`changeSetId`는 validated immutable snapshot을 가리킨다. Preview 후 frontend가 changes를 바꿨다면 새 Preview가 필요하다.

### 12.2 `changes_commit`

Permission: `dbpod:data-write`

```ts
type ChangesCommitRequest = {
  context: RequestContext
  changeSetId: string
  confirmProduction: boolean
}

type ChangesCommitEvent =
  | { type: 'started'; totalRows: number }
  | { type: 'progress'; completedRows: number }
  | { type: 'completed'; rows: UpdatedRow[] }
  | { type: 'conflict'; conflicts: RowConflict[] }
  | { type: 'failed'; error: AppError }
```

500행 batch 진행 상태는 Channel을 사용한다. terminal event는 정확히 하나다.

### 12.3 `changes_discard`

Rust의 preview snapshot을 즉시 제거한다. frontend edit buffer 제거는 UI action이 별도 수행한다.

## 13. History

### 13.1 `history_list`

Permission: `dbpod:history-read`

connection, status, 날짜 filter와 cursor pagination을 지원한다.

### 13.2 `history_delete`

Permission: `dbpod:history-write`

- selected IDs
- connection 전체
- 전체

중 하나의 정확한 scope를 요구한다.

## 14. Settings

### 14.1 `settings_get`

비민감 설정만 반환한다.

### 14.2 `settings_update`

- schema validation
- unknown key 거부
- 변경 가능한 whitelist
- security lowering 설정은 별도 확인

## 15. Rate와 size limit

| 항목 | 제한 |
| --- | --- |
| SQL text | 1MiB |
| Query row count | 고정 제한 없음 (메모리 예산 적용) |
| Query timeout | 1시간 |
| query result page rows | 200 (Table Data stream chunk: 첫 50 / 후속 100) |
| chunk soft bytes | 1MiB |
| paste cells | 10,000 |
| edit batch rows | 500 |
| large value fetch | request당 1MiB |
| metadata page | 최대 1,000 |

## 16. Idempotency

- mutation command는 `requestId`를 요구한다.
- 동일 requestId와 같은 payload 재시도는 이전 결과를 반환할 수 있다.
- 동일 requestId와 다른 payload는 `IDEMPOTENCY_CONFLICT`다.
- query_execute는 execution이 이미 접수되었으면 같은 executionId를 반환한다.
- commit은 같은 changeSetId/requestId로 중복 실행하지 않는다.

## 17. Redaction

다음 field type은 `Debug` 출력과 structured logging에서 redacted된다.

- `SecretInput`
- password/masterPassword
- private key/certificate body
- SQL text
- DbValue
- RowChange

diagnostic에는 ID, byte length, count, duration과 error code만 기록한다.

## 18. 수용 조건

- main local webview 외 source가 query command를 호출할 수 없다.
- secret request와 Result row가 debug log에 나타나지 않는다.
- generated TypeScript type이 Rust contract와 일치한다.
- Query Channel은 columns-before-rows와 terminal exactly-once를 지킨다.
- duplicate commit request가 두 번 저장되지 않는다.
- closed Result Tab의 valueHandle을 사용할 수 없다.
- request size와 page limit이 모든 boundary에서 검증된다.


## 구현 바인딩과 현재 확정된 추가 제약 (2026-09-08)

위 타입은 제품 계약의 목표 범위를 포함한다. 현재 실행 가능한 command의 정확한 필드 집합은 Rust domain에서 생성하는 `src/generated/ipc-types.ts`가 기준이며, `RequestContext`·capabilities 등 미구현 항목은 이 바인딩에 없다.

- `ConnectionOpenRequest.password`: 일회용 비밀번호, null이면 저장된 자격 증명 사용. 응답·profile·mutation cache에 비밀번호를 저장하지 않는다.
- `RowChange.Delete.originalValues`: UPDATE와 마찬가지로 필수. xmin이 없으면 표시된 원본 값으로 동시 변경을 검사한다.
- 변경 preview는 10분 뒤 만료하고 resultRelease/connectionClose/결과 재실행에 따라 폐기된다. resultTabId와 connectionId 소유권이 일치해야 한다.
- terminal은 서버 실행 결과가 확인된 후 한 번만 보낸다. 연결 유실로 확정할 수 없으면 QUERY_OUTCOME_UNKNOWN/COMMIT_OUTCOME_UNKNOWN을 반환한다.
