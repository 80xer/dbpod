# DBPod 아키텍처

- 상태: MVP 기준선
- 최종 수정일: 2026-07-27

## 1. 목표

- React WebView와 Rust Core 사이에 명확한 신뢰 경계를 둔다.
- PostgreSQL 세션, 실행 취소와 transaction 의미를 보존한다.
- 대용량 결과가 단일 JSON 응답과 React render를 막지 않게 한다.
- 데스크톱 직접 연결과 향후 모바일 Gateway를 같은 application contract로 지원한다.
- PostgreSQL 전용 MVP를 단순하게 구현하되 MySQL을 추가할 수 없는 구조적 결합은 피한다.
- 비밀값, Query Result와 UI layout의 저장 위치를 분리한다.

## 2. 시스템 컨텍스트

```text
┌──────────────────────────────────────────────────────────┐
│ DBPod Application                                        │
│                                                          │
│  React WebView                 Rust Core                 │
│  ┌─────────────────┐   IPC    ┌───────────────────────┐ │
│  │ Router/UI       │◀────────▶│ Tauri Commands       │ │
│  │ Workspace State │ Channel  │ Application Services │ │
│  │ Result Store    │◀─────────│ Session Registry     │ │
│  │ TanStack        │          │ Credential Vault     │ │
│  └─────────────────┘          │ PostgreSQL Adapter    │ │
│                               └───────────┬───────────┘ │
└───────────────────────────────────────────│─────────────┘
                                            │ TLS
                                            ▼
                                      PostgreSQL Server
```

React는 UI와 사용자 의도를 소유한다. Rust Core는 자격 증명, 연결, 세션, SQL 실행, 값 decode, generated write SQL과 persistence를 소유한다.

## 3. 신뢰 경계

### 3.1 React WebView

신뢰하지 않는 입력 경계로 취급한다.

- opaque ID도 Rust에서 존재와 ownership을 검증한다.
- connection string을 구성하지 않는다.
- 비밀번호를 저장하거나 다시 읽지 않는다.
- generated UPDATE/INSERT/DELETE SQL을 직접 만들지 않는다.
- capability에 허용된 command만 호출한다.

### 3.2 Rust Core

- DB 자격 증명과 session을 소유한다.
- IPC 입력을 구조적으로 검증한다.
- SQL text는 사용자가 의도한 arbitrary input으로 취급한다.
- SQL 실행 권한을 확대하지 않는다.
- 로그 redaction을 중앙에서 적용한다.

### 3.3 PostgreSQL

최종 인증·인가와 constraint 경계다.

- Role과 RLS가 실제 권한을 결정한다.
- Safe Mode와 SQL parser는 사고 방지 UX다.
- trigger와 server 반환값을 권위 있는 결과로 사용한다.

## 4. 저장소 구조

초기 권장 구조:

```text
dbpod/
├── src/
│   ├── app/
│   │   ├── router/
│   │   ├── providers/
│   │   └── shell/
│   ├── features/
│   │   ├── connections/
│   │   ├── object-explorer/
│   │   ├── query-editor/
│   │   ├── result-grid/
│   │   ├── data-editing/
│   │   ├── query-history/
│   │   └── settings/
│   ├── entities/
│   │   ├── connection/
│   │   ├── workspace/
│   │   ├── query/
│   │   └── result/
│   ├── shared/
│   │   ├── ipc/
│   │   ├── ui/
│   │   ├── lib/
│   │   └── styles/
│   └── generated/
│       └── ipc-types.ts
├── src-tauri/
│   └── src/
│       ├── commands/
│       ├── application/
│       ├── domain/
│       ├── infrastructure/
│       │   ├── postgres/
│       │   ├── persistence/
│       │   └── platform/
│       ├── security/
│       ├── state/
│       ├── error.rs
│       └── lib.rs
├── docs/
└── tests/
```

## 5. Frontend

### 5.1 App layer

- TanStack Router 구성
- 전역 provider
- Tauri runtime bootstrap
- theme와 i18n
- top-level error boundary
- application shell

Router는 다음 화면만 소유한다.

- saved connections
- workspace
- settings
- diagnostics/about

SQL, Result row와 credential은 URL/search state에 넣지 않는다.

### 5.2 Feature layer

사용자 기능 단위로 UI, hooks, actions와 feature-local type을 둔다. feature가 다른 feature의 내부 파일을 import하지 않고 entity/shared contract를 사용한다.

### 5.3 State

| 상태 | 소유자 |
| --- | --- |
| route | TanStack Router |
| metadata server state | TanStack Query |
| Connection Workspace와 Work Tab | `useReducer` 기반 Workspace Store |
| Result row chunk | 외부 in-memory Result Store |
| Result Grid UI state | Result Store 또는 tab-scoped state |
| form | TanStack Form |
| CodeMirror document | CodeMirror state, Workspace draft 연동 |
| secrets | Rust Core only |

Workspace Context는 state와 dispatch를 분리하고 selector 경계를 둬 불필요한 전체 rerender를 피한다.

### 5.4 Result Store

Result row를 React state array로 반복 복사하지 않는다.

```ts
interface ResultStore {
  create(resultTabId: string, columns?: ColumnMeta[]): void
  appendRows(resultTabId: string, sequence: number, rows: DbValue[][]): void
  setTerminal(resultTabId: string, terminal: ResultTerminal): void
  getSnapshot(resultTabId: string): ResultSnapshot
  subscribe(resultTabId: string, listener: () => void): () => void
  dispose(resultTabId: string): void
}
```

Grid는 `useSyncExternalStore` 또는 동등한 selector subscription으로 필요한 snapshot만 구독한다.

## 6. Rust Core

### 6.1 Commands

Tauri adapter다.

- IPC deserialize
- capability와 invoking window 확인
- request size와 ID validation
- application service 호출
- AppError serialize

비즈니스 규칙을 command 함수에 직접 넣지 않는다.

### 6.2 Application services

- `ConnectionService`
- `MetadataService`
- `QueryService`
- `EditService`
- `HistoryService`
- `SettingsService`
- `VaultService`

application service는 domain model을 조합하고 transaction 경계를 관리한다.

### 6.3 Domain

- ConnectionProfile
- QuerySession
- Execution
- Result metadata
- DbValue
- ChangeSet
- AppError

Tauri, SQLx와 파일 경로 같은 infrastructure type이 domain API에 노출되지 않게 한다.

### 6.4 PostgreSQL infrastructure

- connection option 생성
- TLS와 certificate
- SQLx connection/session
- metadata catalog query
- dynamic row decode
- cancellation
- generated write SQL 실행

PostgreSQL 전용 코드는 `infrastructure/postgres` 아래에 모은다.

## 7. Connection Manager

```text
ConnectionManager
├── profiles
├── workspace handles
├── control pools
└── query sessions
    └── queryTabId -> QuerySessionActor
```

### 7.1 Control pool

용도:

- metadata
- health check
- cancellation
- table browsing
- edit transaction

기본 크기:

- desktop: min 1, max 4
- mobile: min 0, max 2

### 7.2 Query session

- Query Tab별 lazy `PgConnection`
- 한 actor가 순차적으로 command 처리
- 동시에 하나의 execution
- backend PID와 transaction state 추적
- 탭 닫기 시 graceful close

actor mailbox를 bounded로 설정해 중복 실행이 무한 대기하지 않게 한다.

## 8. Query 실행 데이터 흐름

```text
User
  │ Run
  ▼
Query Feature
  │ query_execute(request, Channel)
  ▼
Tauri Command
  ▼
QueryService
  ▼
QuerySessionActor
  │ SQLx row stream
  ▼
Value Decoder
  │ QueryStreamEvent
  ▼
Tauri Channel
  ▼
Result Store
  ▼
TanStack Table + Virtual
```

command 응답은 실행 접수만 의미한다. 성공, 실패와 취소는 Channel terminal event로 확정한다.

## 9. Database Transport

application layer는 다음 interface에 의존한다.

```rust
trait DatabaseTransport {
    async fn open_workspace(&self, profile: &ConnectionProfile) -> Result<WorkspaceHandle>;
    async fn open_query_session(&self, workspace: &WorkspaceHandle) -> Result<QuerySessionHandle>;
    async fn execute(
        &self,
        session: &QuerySessionHandle,
        request: ExecuteRequest,
        sink: QueryEventSink,
    ) -> Result<ExecutionHandle>;
    async fn cancel(&self, execution: &ExecutionHandle) -> Result<()>;
    async fn close_query_session(&self, session: QuerySessionHandle) -> Result<()>;
}
```

MVP 구현은 `DirectPostgresTransport` 하나다. Gateway는 별도 protocol과 threat model이 확정되기 전 구현하지 않는다.

## 10. IPC type

- Rust `serde` model을 source of truth로 사용한다.
- TypeScript binding을 build step에서 생성한다.
- generated file을 수동 수정하지 않는다.
- CI가 Rust와 TypeScript contract drift를 검사한다.
- external tagged enum에는 명시적 discriminant를 사용한다.

## 11. 오류

모든 boundary는 `AppError`로 변환한다.

계층:

```text
Infrastructure Error
      ▼ map/redact
Domain/Application Error
      ▼ serialize
IPC AppError
      ▼ localize
User-facing message
```

Rust error 전문을 그대로 UI에 내보내지 않는다. SQLSTATE, position, safe detail과 hint는 보존한다.

## 12. 동시성

- QuerySessionActor 하나당 execution 하나
- Query Tab 사이 execution 병렬 허용
- metadata와 edit는 control pool 사용
- edit transaction은 Result Tab 단위 mutex로 중복 Save 방지
- Result chunk 순서는 execution sequence로 검증
- app shutdown은 새 작업을 막고 실행 취소, rollback, session close 순서로 처리

## 13. 보안 아키텍처

- bundled local frontend만 IPC 허용
- command별 최소 capability
- strict CSP
- remote source와 iframe 금지
- credential vault와 일반 설정 분리
- TLS `verify-full` 기본
- logging redaction middleware
- updater signature verification

상세 내용은 [`../security/threat_model.md`](../security/threat_model.md)와 [`../security/security_baseline.md`](../security/security_baseline.md)를 따른다.

## 14. 테스트 경계

- domain: pure unit test
- application service: fake transport/vault test
- PostgreSQL adapter: disposable real PostgreSQL integration test
- IPC: serialization/permission contract test
- frontend feature: component and store test
- app: Tauri desktop E2E smoke test

## 15. 의존성 규칙

```text
UI -> Feature -> Entity/Shared Contract
Command -> Application -> Domain
Infrastructure -> Domain port implementation
Domain -> no Tauri/SQLx/React dependency
```

- circular feature import 금지
- `shared`를 임의 유틸리티 쓰레기통으로 사용하지 않음
- PostgreSQL query string은 adapter 또는 catalog repository에 위치
- 보안 redaction은 모든 log sink 앞에 위치

## 16. 구현 순서

1. typed IPC와 AppError
2. secure connection profile과 connection test
3. QuerySessionActor와 text/number 소형 result
4. Tauri Channel과 Result Store
5. PostgreSQL 주요 타입 decode
6. Query/Result Tab UI
7. Table Data metadata와 pagination
8. editing, Preview SQL과 transaction
9. clipboard와 mobile adaptation

## 17. 수용 조건

- React code에서 connection string을 만들지 않는다.
- Query Tab transaction이 다른 Query Tab과 섞이지 않는다.
- Result row가 일반 command JSON 응답으로 한 번에 반환되지 않는다.
- Result Tab dispose가 frontend row buffer와 Rust execution handle을 정리한다.
- Rust/TypeScript generated contract가 CI에서 일치한다.
- domain module이 Tauri와 SQLx에 의존하지 않는다.
- 비밀값은 VaultService 외부 persistence에 기록되지 않는다.

