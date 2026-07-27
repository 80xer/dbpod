# DBPod 테스트 전략

- 상태: MVP 기준선
- 최종 수정일: 2026-07-27

## 1. 원칙

- 기능과 bugfix는 실패하는 test에서 시작한다.
- domain 규칙은 빠른 unit test로 보호한다.
- PostgreSQL semantics는 mock이 아니라 실제 disposable DB로 확인한다.
- IPC contract는 Rust와 TypeScript 양쪽에서 검증한다.
- 보안, 성능과 접근성은 release 전 수동 점검만으로 남기지 않는다.
- flaky test를 retry로 숨기지 않는다.

## 2. Test pyramid

```text
             Desktop/Mobile E2E
          IPC and Security Contract
       PostgreSQL Integration Tests
    Frontend Component and Store Tests
          Rust/TS Unit Tests
```

## 3. Unit test

### Rust

- statement boundary splitter
- DbValue encode/decode
- AppError mapping/redaction
- connection profile validation
- ID ownership validation
- Result stream sequence
- generated identifier quoting
- changeSet validation
- optimistic lock SQL template
- persistence migration
- retention and log rotation

### TypeScript

- Workspace reducer
- Result Store append/dispose
- Result Tab replacement/protection
- type formatter/comparator
- TSV parser/mapping
- Grid keyboard state
- mobile/desktop command mapping
- localization key completeness

### Property/fuzz

- SQL splitter: quote/comment/dollar quote 조합
- TSV parser: quote/newline/empty/trailing field
- decimal/integer comparator
- DbValue serialize/deserialize round-trip
- identifier quoting
- malformed stream sequence

## 4. Component test

React Testing Library 계열의 사용자 관점 test를 사용한다.

대상:

- Connection Form validation
- Connection/Environment indicator
- Object Sidebar search
- Work Tab close confirmation
- Query Toolbar command
- Result Tab keyboard navigation
- Result Grid focus, selection, copy/paste
- edit conflict dialog
- mobile Drawer/Bottom Sheet
- privacy lock screen

implementation detail보다 role, accessible name와 visible state를 assertion한다.

## 5. PostgreSQL integration test

### 5.1 환경

- disposable PostgreSQL container
- test별 isolated database 또는 schema
- migration fixture
- 최소 권한 Role, read-only Role, RLS Role와 superuser fixture
- valid CA, invalid CA와 hostname mismatch TLS fixture

### 5.2 지원 버전

- PostgreSQL 14~18
- PR 기본 integration: 16, 18
- nightly matrix: 14, 15, 16, 17, 18

PostgreSQL protocol-compatible database는 MVP 공식 지원에서 제외한다.

### 5.3 주요 test

- connection/TLS/auth
- metadata/schema/object
- Query Tab session affinity
- BEGIN/COMMIT/ROLLBACK
- temporary table과 SET
- concurrent Query Tabs
- cancellation
- timeout
- row streaming/order
- all documented DbValue categories
- permission denied/RLS
- Table Data pagination
- edit/insert/delete transaction
- optimistic conflict
- trigger/generated/default
- batch rollback

## 6. IPC contract test

- Rust type에서 TypeScript binding 재생성 후 diff 없음
- command request size/range validation
- wrong webview/capability 거부
- wrong connection/session/result ownership 거부
- duplicate requestId idempotency
- Channel columns-before-rows
- rows sequence
- terminal exactly-once
- tab close channel cleanup
- large value handle lifecycle
- secret serialization/log redaction

## 7. E2E

### 7.1 Web UI

Tauri 없이 가능한 layout와 feature flow는 빠른 browser E2E로 실행한다.

- responsive layout
- keyboard tabs
- editor/results switch
- Grid interaction
- theme
- accessibility

Rust IPC는 typed fake adapter를 사용한다.

### 7.2 Tauri desktop

- app launch
- vault initialize/unlock
- connection create/test/open
- Query 실행과 새 Result Tab
- cancel
- table edit/paste/save
- disconnect/restart
- updater staging smoke

### 7.3 Mobile

- Android emulator와 iOS simulator build
- Connection Switcher
- Object Drawer
- Editor/Results transition
- Run/New Result action
- Bottom Sheet edit
- background privacy
- external keyboard smoke

## 8. Security test

### Automated

- CSP/capability snapshot
- XSS payload fixtures in schema/table/cell/error
- secret scan of logs and app data
- insecure TLS downgrade negative test
- invalid cert/hostname
- generated SQL injection property test
- cross-tab cancellation attack
- malformed IPC
- CSV formula injection
- dependency and license scan
- updater signature tamper

### Manual release test

- OS secure storage inspection
- mobile clipboard and snapshot
- code signing
- file permission
- diagnostics preview
- production Safe Mode

## 9. Accessibility

- automated axe 계열 test
- keyboard-only flow
- screen reader smoke: VoiceOver, NVDA
- high contrast/forced colors
- 200% text zoom
- reduced motion
- coarse pointer target

Grid virtualization의 screen reader 동작은 실제 assistive technology로 확인한다.

## 10. Performance test

- cold/warm startup
- 500, 5,000, 10,000 row ingest
- 100/300 column grid
- 1MiB text/binary cell
- 10 Result Tabs
- 8 Query sessions
- 100-row/500-row paste commit
- memory after Result Tab dispose
- sustained scroll frame rate

예산은 [`performance_budget.md`](performance_budget.md)를 따른다.

## 11. Coverage gate

초기 목표:

- Rust domain/application: line 90%, branch 80%
- frontend reducer/store/lib: line 90%, branch 80%
- 전체 project: line 80%

coverage 수치보다 다음 critical path test 존재를 우선한다.

- secret
- generated SQL
- cancellation
- transaction
- type precision
- edit conflict
- persistence migration

## 12. CI 단계

### Pull request

1. formatting
2. lint
3. TypeScript typecheck
4. Rust check/clippy
5. unit/component
6. PostgreSQL 16/18 integration
7. IPC contract generation diff
8. security/dependency scan
9. desktop build smoke

### Nightly

- PostgreSQL full matrix
- Windows/macOS/Linux E2E
- mobile build
- performance regression
- fuzz corpus
- license/SBOM

### Release

- all PR/nightly gate
- signed package
- updater tamper test
- manual security/accessibility checklist

## 13. Flaky test 정책

- flaky test에는 owner와 issue가 필요하다.
- 무기한 quarantine 금지
- retry는 원인 조사용 telemetry로만 사용
- timing sleep 대신 observable state를 기다린다.
- test data와 port를 격리한다.

## 14. Test data

- 실제 고객 또는 production data 사용 금지
- synthetic fixtures만 저장소에 commit
- secret scanner에 걸리는 fake secret은 allowlist 사유 기록
- timezone, Unicode, RTL, emoji, large numeric와 malicious text 포함

## 15. 완료 정의

기능은 다음 조건을 만족해야 완료다.

- 명세 acceptance criteria test
- unit/integration/E2E 적정 범위
- 접근성 상태
- error/recovery flow
- security review 필요 여부
- 문서와 generated binding 갱신
- 성능 예산 regression 없음

