# ADR-0006: Milestone A 구현 도구 선택

- 상태: Accepted
- 날짜: 2026-09-03

## Context

plan-mvp Phase 0.5는 IPC 바인딩 생성기, SQL 문장 경계 파서, 보안 저장소, 테스트 하네스 선택을 spike 항목으로 남겨두었다. 첫 수직 슬라이스(연결 → 실행 → 스트리밍 → 취소 → 정리) 구현 과정에서 다음과 같이 결정했다.

## Decision

### Rust→TS IPC 바인딩: ts-rs

- 모든 IPC serde 타입에 `#[derive(TS)]`를 적용하고 `cargo test --test export_bindings`가 `src/generated/ipc-types.ts` 단일 파일을 생성한다.
- CI는 재생성 후 `git diff --exit-code`로 드리프트를 검출한다.
- tauri-specta는 RC 단계이고 Channel 타이핑이 미성숙해 보류한다. invoke 래퍼는 커맨드당 1줄이라 수기 유지 비용이 낮다.
- 64비트 정수 필드는 `#[ts(type = "number")]`로 강제한다. serde_json이 JSON number로 직렬화하므로 런타임과 타입을 일치시킨다. int8 무손실 표현은 타입 명세에 따라 Milestone B에서 문자열로 전환한다.

### SQL 문장 경계 파서: TypeScript 수제 lexer

- 문장 경계 검출은 에디터 커서 좌표가 필요하므로 프론트엔드에서 실행한다 (`statementSplitter.ts`, 따옴표·달러쿼트·중첩 주석·세미콜론 처리).
- pg_query.rs는 libpg_query C 의존으로 모바일 빌드 위험이 있고, sqlparser-rs는 유효한 PostgreSQL SQL을 파싱하지 못하는 사례가 있어 경계 검출 용도로는 과하다.
- Rust 측 다중문 차단은 SQLx extended query protocol의 prepare가 구조적으로 보장한다.

### 비밀 저장: keyring crate (OS Keychain 직접)

- service `com.niceinvesting.dbpod`, account = profileId로 비밀번호를 OS Keychain에 저장한다.
- IOTA Stronghold는 유지보수 모드라 신규 채택하지 않는다.
- macOS Keychain은 별도 잠금 해제가 없으므로 `vault_status`는 `unlocked` 고정이다. 마스터 비밀번호 폴백 vault는 Linux Secret Service 부재 대응과 함께 후속 단계에서 구현한다.

### 테스트: Vitest + testcontainers-modules

- 프론트: Vitest(+RTL). Rust 통합: testcontainers-modules `postgres`로 `cargo test`가 일회용 PostgreSQL을 스스로 기동·정리한다.
- 데스크톱 E2E는 tauri-driver가 macOS를 지원하지 않아 연기한다. 통합 테스트가 스트리밍·백프레셔·취소·정리 계약을 대신 검증한다.

### 기타

- TanStack Table은 v9의 API 전면 개편(createTableHook)이 검증되지 않아 v8로 고정한다. Milestone A 그리드는 컬럼 헤더 + TanStack Virtual 행 가상화만 사용하고, 정렬·고정·리사이즈가 들어오는 Milestone B에서 Table 모델을 도입한다.
- 트랜잭션 상태는 command tag 기반 상태 머신으로 추적한다(BEGIN/COMMIT/ROLLBACK + 오류 시 failed). sqlx가 ReadyForQuery 상태를 노출하면 교체한다.

## Consequences

- 위 선택은 모두 교체 가능한 어댑터 뒤에 있다: 바인딩 생성기(테스트 1개), 파서(모듈 1개), keychain(`infrastructure/platform`), 그리드 모델(컴포넌트 1개).
- Milestone B에서 DbValue 전체 타입 명세 적용 시 int8 문자열 전환과 함께 바인딩을 재생성해야 한다.
