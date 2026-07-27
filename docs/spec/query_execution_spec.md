# DBPod 쿼리 실행 명세

- 상태: MVP 기준선
- 최종 수정일: 2026-07-27

## 1. 목적

이 문서는 Query Tab의 PostgreSQL 세션, SQL 범위 판별, 실행, 스트리밍, 결과 교체, 새 Result Tab, cancellation, timeout, transaction과 오류 계약을 정의한다.

## 2. 핵심 결정

- Query Tab 하나는 첫 실행부터 닫힐 때까지 하나의 PostgreSQL 세션을 유지한다.
- 선택 영역이 있으면 선택 SQL을, 없으면 커서가 있는 현재 구문 하나를 실행한다.
- MVP는 `Run All`을 지원하지 않는다.
- 한 Query Tab에는 동시에 하나의 execution만 허용한다.
- 서로 다른 Query Tab은 동시에 실행할 수 있다.
- Tauri command는 실행 접수에 사용하고 row 결과는 Tauri Channel로 전달한다.
- Result Tab 한 개는 execution 한 번의 결과 스냅샷이다.
- 기본 실행은 활성화된 보호되지 않은 Result Tab을 교체한다.
- 새 결과 실행은 기존 결과를 유지하고 새 Result Tab을 만든다.

Tauri 공식 문서가 ordered high-throughput streaming에 Channel을 권장하므로 전역 event bus를 결과 전송에 사용하지 않는다.

## 3. Query Tab 세션

### 3.1 생성

- Query Tab 생성만으로 PostgreSQL 연결을 열지 않는다.
- 첫 실행 시 `query_session_open`을 lazy하게 수행한다.
- session은 `connectionId + queryTabId`로 식별한다.
- 실제 DB 자격 증명과 backend secret은 Rust Core에만 존재한다.

### 3.2 유지되는 상태

같은 Query Tab의 모든 실행은 같은 session을 사용하므로 다음 상태가 유지된다.

- transaction
- temporary table
- `SET`과 `SET ROLE`
- advisory lock
- prepared statement
- session-local configuration

Result Tab을 바꾸거나 새 Result Tab을 생성해도 session은 바뀌지 않는다.

### 3.3 종료

다음 상황에서 session을 정상 종료한다.

- Query Tab 닫기
- Connection Workspace 닫기
- 명시적 disconnect
- 앱 정상 종료

열린 transaction이 있으면 자동 종료 전에 사용자에게 rollback 여부를 확인한다. 앱 crash나 강제 종료 시 PostgreSQL 연결 종료에 따라 server가 transaction을 rollback한다.

### 3.4 세션 수

- desktop Connection Workspace 기본 최대 Query session: 8
- mobile 기본 최대 Query session: 3
- 설정 가능 범위: 1~20
- 아직 실행하지 않은 Query Tab은 session 수에 포함하지 않는다.
- 한도 도달 시 가장 오래된 session을 임의 종료하지 않고 사용자에게 탭 종료 또는 한도 변경을 요청한다.

metadata와 cancellation에는 Query session과 분리된 작은 control pool을 사용한다.

## 4. SQL 실행 범위

### 4.1 우선순위

1. non-empty selection
2. cursor가 있는 statement
3. editor 전체가 하나의 statement일 경우 그 statement
4. 그 외에는 실행하지 않고 범위 선택을 요청

### 4.2 statement 경계

statement splitter는 최소한 다음 PostgreSQL 문법을 인식해야 한다.

- single quoted string
- escaped string
- double quoted identifier
- dollar quoted body
- line comment
- nested block comment
- semicolon

문자열, dollar quote와 comment 안의 semicolon은 statement 경계로 취급하지 않는다.

MVP splitter가 구문을 안전하게 분리하지 못하면 임의 추측으로 실행하지 않고 selection 실행을 안내한다.

### 4.3 빈 입력

공백과 comment만 있는 SQL은 Rust Core를 호출하지 않는다. UI가 focus를 유지하고 `실행할 SQL이 없습니다`를 표시한다.

### 4.4 다중 문장

`Run All`과 selection 안의 다중 statement 실행은 MVP에서 거부한다. 다중 statement transaction, 부분 실패와 복수 결과 grouping 정책을 별도 명세한 후 추가한다.

## 5. 실행 명령

### 5.1 기본 실행

- 명령: `Run Current Query`
- 단축키: `Cmd/Ctrl + Enter`

동작:

1. SQL 범위를 결정한다.
2. active Result Tab이 없으면 `Result 1`을 만든다.
3. active Result Tab이 교체 가능하면 같은 tab identity를 유지하며 초기화한다.
4. active Result Tab이 보호 상태면 새 Result Tab을 만든다.
5. Result Tab을 `running`으로 바꾼다.
6. Rust Core 실행을 요청한다.

### 5.2 새 결과 실행

- 명령: `Run Query in New Result Tab`
- 단축키: `Cmd/Ctrl + Shift + Enter`

동작:

1. active Result Tab 오른쪽에 새 Result Tab을 만든다.
2. 새 탭을 즉시 활성화한다.
3. 기존 Result Tab은 변경하지 않는다.
4. 새 Result Tab에 execution stream을 연결한다.

### 5.3 보호 상태

Result Tab은 다음 중 하나이면 교체할 수 없다.

- pinned
- pending edit 존재
- running 또는 cancelling
- export 진행 중

보호 상태에서 기본 실행을 누르면 새 Result Tab을 만들고 이유를 toast가 아닌 접근 가능한 status announcement로 알린다.

## 6. 실행 요청

```ts
type QueryExecuteRequest = {
  connectionId: string
  queryTabId: string
  resultTabId: string
  sql: string
  mode: 'replace' | 'new-result'
  maxRows: number
  timeoutMs: number
  requestId: string
}
```

제약:

- `sql`: UTF-8, 기본 최대 1MiB
- `maxRows`: 1~10,000, 기본 500
- `timeoutMs`: 1,000~3,600,000, 기본 60,000
- `requestId`: UI retry 중복 접수 방지용 UUID
- `connectionId`, `queryTabId`, `resultTabId`: Rust가 발급하거나 검증한 opaque ID

command 성공 응답:

```ts
type ExecutionAccepted = {
  executionId: string
  sessionId: string
  acceptedAt: string
}
```

command 성공은 쿼리 성공이 아니라 실행 접수 성공을 의미한다.

## 7. 결과 스트림

### 7.1 이벤트

```ts
type QueryStreamEvent =
  | {
      type: 'started'
      executionId: string
      backendPid: number
      startedAt: string
    }
  | {
      type: 'columns'
      executionId: string
      columns: ColumnMeta[]
    }
  | {
      type: 'rows'
      executionId: string
      sequence: number
      rows: DbValue[][]
    }
  | {
      type: 'notice'
      executionId: string
      severity: string
      message: string
    }
  | {
      type: 'command'
      executionId: string
      commandTag: string
      affectedRows?: number
    }
  | {
      type: 'completed'
      executionId: string
      rowCount: number
      truncated: boolean
      durationMs: number
      transactionState: 'idle' | 'in-transaction' | 'failed-transaction'
    }
  | {
      type: 'failed'
      executionId: string
      error: AppError
      durationMs: number
      transactionState: 'idle' | 'in-transaction' | 'failed-transaction'
    }
  | {
      type: 'cancelled'
      executionId: string
      receivedRowCount: number
      durationMs: number
      transactionState: 'idle' | 'in-transaction' | 'failed-transaction'
    }
```

### 7.2 순서

- 첫 이벤트는 `started`다.
- row 결과에서는 `columns`가 모든 `rows`보다 먼저 온다.
- `rows.sequence`는 0부터 연속 증가한다.
- terminal 이벤트는 `completed`, `failed`, `cancelled` 중 정확히 하나다.
- terminal 이벤트 이후 같은 execution의 이벤트를 보내지 않는다.

### 7.3 chunk

- 기본 chunk: 100행
- 첫 화면 latency를 줄이기 위해 첫 chunk는 최대 50행
- 한 chunk 직렬화 크기 soft limit: 1MiB
- 큰 cell이 있으면 행 수보다 byte limit을 우선한다.
- 단일 cell이 최대 크기를 넘으면 preview만 보내고 별도 value fetch handle을 제공한다.

### 7.4 backpressure

- Rust producer는 bounded buffer를 사용한다.
- UI는 chunk를 Result Store에 반영한 뒤 `query_ack_chunk(executionId, sequence)`를 보낸다.
- 미확인 chunk는 최대 2개다.
- Result Tab이 닫히면 UI는 `query_cancel` 후 channel과 buffer를 해제한다.

### 7.5 행 제한

- `maxRows` 도달 시 더 이상 row를 받지 않고 query를 정상적으로 마무리한다.
- `truncated: true`를 표시한다.
- arbitrary query에는 SQL text를 자동 rewrite해 `LIMIT`을 삽입하지 않는다.
- driver stream에서 maxRows까지만 수집하고 남은 결과 처리를 중단 또는 cancel한다.
- Table Data Tab은 server-side pagination을 사용한다.

## 8. 실행 취소

### 8.1 요청

```ts
type QueryCancelRequest = {
  executionId: string
}
```

### 8.2 처리

1. execution registry에서 session과 backend PID를 찾는다.
2. Result Tab 상태를 `cancelling`으로 바꾼다.
3. control connection으로 해당 backend의 현재 query 취소를 요청한다.
4. PostgreSQL session이 error 또는 ready 상태로 돌아올 때까지 기다린다.
5. terminal `cancelled` 또는 실제 완료 상태를 전송한다.

PostgreSQL CancelRequest는 성공 여부를 직접 응답하지 않을 수 있으므로 UI는 server query의 terminal 응답을 기준으로 상태를 확정한다.

### 8.3 강제 종료

- cancel 요청 후 2초 동안 terminal 응답이 없으면 `Force disconnect session`을 제공한다.
- 강제 종료는 해당 Query Tab session만 닫는다.
- 열린 transaction은 server에서 rollback된다.
- 다른 Query Tab과 control pool은 유지한다.
- 사용자가 재실행하면 새 session을 lazy하게 연다.

## 9. timeout

- 기본 query timeout: 60초
- 연결 설정 범위: 1초~1시간
- `0` 무제한은 Advanced 설정에서만 허용
- client-side timer와 PostgreSQL `statement_timeout`을 함께 사용한다.
- timeout은 `QUERY_TIMEOUT` 오류로 표시하고 received rows가 있으면 불완전 결과로 보존한다.
- transaction 안에서 timeout이 발생하면 failed transaction 상태를 표시하고 `ROLLBACK`을 주요 action으로 제공한다.

## 10. transaction

### 10.1 기본

- PostgreSQL 기본 autocommit을 따른다.
- 사용자는 `BEGIN`, `COMMIT`, `ROLLBACK`을 각각 현재 statement로 실행할 수 있다.
- 같은 Query Tab session을 사용하므로 transaction이 유지된다.

### 10.2 상태 표시

Query Toolbar와 Status Bar에 다음을 표시한다.

- `Auto Commit`
- `In Transaction`
- `Transaction Failed`
- `Read Only`

failed transaction에서는 `ROLLBACK` 이외 쿼리 실행을 막지 않지만 PostgreSQL 오류를 예측해 안내한다.

### 10.3 종료

- 열린 transaction이 있는 Query Tab 닫기: `Rollback and close` 또는 `Cancel`
- 앱 정상 종료: 열린 transaction 목록을 보여주고 rollback 후 종료
- crash: 연결 종료에 의한 server rollback

### 10.4 생성 편집 SQL

Grid의 Save는 Query Tab의 수동 transaction에 합류하지 않고 별도 명시적 edit transaction을 사용한다. 서로 다른 UI 작업의 commit 경계를 섞지 않는다.

## 11. Safe Mode

Safe Mode는 사고 방지 UX이며 권한 경계가 아니다.

모드:

- `Off`: 추가 경고 없음
- `Warn Writes`: 쓰기 또는 DDL로 분류한 statement 확인
- `Confirm All`: 모든 statement 확인
- `Password Confirm`: PROD의 쓰기·DDL에 vault 재인증 요구

`SELECT`도 write function을 호출할 수 있으므로 SQL 분류만으로 안전을 보장하지 않는다. 실제 보호는 최소 권한 PostgreSQL Role과 read-only transaction을 사용한다.

## 12. 오류 모델

```ts
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

표준 code:

- `INVALID_REQUEST`
- `SESSION_LIMIT_REACHED`
- `QUERY_ALREADY_RUNNING`
- `QUERY_PARSE_BOUNDARY_FAILED`
- `QUERY_TIMEOUT`
- `QUERY_CANCELLED`
- `CONNECTION_LOST`
- `TLS_ERROR`
- `AUTH_ERROR`
- `PERMISSION_DENIED`
- `POSTGRES_ERROR`
- `RESULT_TOO_LARGE`
- `INTERNAL_ERROR`

오류에는 SQL 전문, bind value, 비밀번호, connection string을 넣지 않는다.

## 13. Query History

- 성공, 실패와 취소된 실행을 기록할 수 있다.
- SQL은 암호화된 로컬 저장소에 저장한다.
- row와 cell 값은 저장하지 않는다.
- 기본 보존 기간은 30일, 최대 1,000개다.
- 사용자는 History를 비활성화하거나 즉시 삭제할 수 있다.
- password pattern 탐지는 보조 수단일 뿐이며 SQL을 안전하다고 분류하는 데 사용하지 않는다.

## 14. 수용 조건

- 같은 Query Tab에서 `BEGIN`, 후속 statement, `ROLLBACK`이 같은 backend session을 사용한다.
- 서로 다른 Query Tab은 독립적인 transaction 상태를 가진다.
- 기본 실행은 보호되지 않은 active Result Tab만 교체한다.
- 새 결과 실행은 기존 결과를 변경하지 않는다.
- channel 이벤트 순서와 terminal exactly-once 규칙을 지킨다.
- cancellation은 다른 Query Tab을 종료하지 않는다.
- 500행 결과가 chunk 단위로 UI에 표시된다.
- timeout 후 transaction 상태가 정확히 표시된다.
- 오류와 History에 비밀값 또는 결과 row가 남지 않는다.

