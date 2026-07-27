# DBPod MVP 구현 계획

- 상태: 실행 기준선
- 최종 수정일: 2026-07-27

이 문서는 Phase 전략의 요약이다. 실제 진행 상태와 세부 Task 체크리스트는 [`docs/plan/plan-mvp.md`](../plan/plan-mvp.md)에서 관리한다.

## 1. 전략

화면 전체를 먼저 만드는 대신 실제 PostgreSQL을 연결한 vertical slice를 단계적으로 확장한다. 각 단계는 독립적인 사용자 가치를 제공하고 다음 단계의 위험을 줄여야 한다.

## 2. Phase 0: Scaffold와 guardrail

산출물:

- Vite + React + TypeScript
- Tauri 2
- Tailwind CSS
- TanStack Router/Query/Table/Virtual/Form
- formatting/lint/typecheck
- Rust workspace/module skeleton
- generated IPC binding
- CSP/capability 최소값
- CI desktop build

완료:

- 빈 shell이 macOS/Windows/Linux build
- mobile init/build smoke
- remote capability 없음
- unit test와 PostgreSQL integration harness 동작

## 3. Phase 1: Secure Connection Slice

사용자 가치:

- connection profile을 만들고 TLS로 PostgreSQL 연결 테스트

구현:

- vault initialize/unlock
- profile persistence
- `verify-full`
- connection test
- Connection Workspace/Status
- AppError/redaction

완료:

- valid/invalid CA와 hostname test
- 설정/log에서 secret 없음
- profile create/edit/delete

## 4. Phase 2: Query Streaming Slice

사용자 가치:

- Query Tab에서 SELECT를 실행하고 첫 chunk부터 결과 확인

구현:

- QuerySessionActor
- Query Tab session affinity
- Tauri Channel
- DbValue text/integer/decimal/boolean
- Result Store
- 기본 Result Tab
- timeout/cancel

완료:

- `Cmd/Ctrl + Enter`
- 500행 chunk 표시
- BEGIN/ROLLBACK session test
- cross-tab concurrent query
- cancellation isolation

## 5. Phase 3: Multi Result와 주요 타입

사용자 가치:

- 같은 SQL editor에서 여러 결과 스냅샷 비교

구현:

- `Cmd/Ctrl + Shift + Enter`
- protected Result Tab
- Result Tab dispose
- temporal/JSON/array/binary/unknown
- large value handle
- History

완료:

- Result 5개 비교
- tab close memory cleanup
- type round-trip matrix

## 6. Phase 4: Object Explorer와 Table Data

사용자 가치:

- schema/table 탐색과 paginated data browsing

구현:

- metadata catalog
- Sidebar search/pinned/recent
- Preview Work Tab
- Table Data server pagination/sort/filter
- hidden PK/xmin identity

완료:

- system schema toggle
- permission 제한 표시
- large schema fuzzy search budget

## 7. Phase 5: Editing과 Paste

사용자 가치:

- 셀 수정과 스프레드시트 paste를 transaction으로 저장

구현:

- editability detection
- edit buffer
- Preview SQL
- UPDATE/INSERT/DELETE
- optimistic lock
- conflict resolver
- TSV Preview

완료:

- Table Data edit
- simple Query Result edit
- 100행 paste
- constraint failure 전체 rollback
- concurrent update conflict

## 8. Phase 6: Responsive와 accessibility

사용자 가치:

- tablet/mobile layout과 touch 편집

구현:

- Connection Switcher Sheet
- Object Drawer
- Editor/Results switch
- mobile action bar
- Bottom Sheet editor
- privacy overlay
- keyboard/screen reader

완료:

- 360×800, 768×1024
- VoiceOver/NVDA/TalkBack smoke
- external mobile keyboard

## 9. Phase 7: Release hardening

- platform E2E
- performance/memory
- updater/signing
- SBOM/license inventory
- accessibility checklist
- security baseline
- packaging
- recovery/migration

stable public release는 전용 보안 신고 이메일을 `SECURITY.md`에 등록한 후에만 진행한다.

## 10. 초기 기술 spike

production 구현 전에 time-boxed spike:

1. SQLx dynamic type origin metadata
2. PostgreSQL cancellation
3. Tauri Channel 10,000행과 backpressure
4. TanStack Grid 10,000행/100 column
5. Stronghold + OS secure storage desktop/mobile

spike는 throwaway code여도 결과를 ADR 또는 기존 ADR amendment로 기록한다.

## 11. 첫 vertical slice 완료 정의

첫 개발 milestone은 다음 flow다.

```text
App Launch
→ Vault Unlock
→ Saved PostgreSQL Connection
→ New Query Tab
→ SELECT 실행
→ Tauri Channel rows
→ Result Grid
→ Query Cancel
→ Tab Close/Memory Cleanup
```

이 flow가 real PostgreSQL integration test와 desktop E2E를 통과하기 전 데이터 편집 구현을 시작하지 않는다.
