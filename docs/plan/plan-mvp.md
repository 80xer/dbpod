# DBPod MVP 상세 구현 계획

- 상태: 실행 체크리스트
- 최종 수정일: 2026-07-27
- 대상: PostgreSQL 데스크톱 MVP와 모바일 대응 기반
- 기준 문서: [제품 명세](../product/product_spec.md), [디자인 명세](../spec/design_spec.md), [아키텍처](../architecture/architecture.md)

## 1. 계획 사용법

이 문서는 DBPod MVP 구현의 실행 순서와 완료 상태를 관리하는 단일 체크리스트다.

- 작업을 시작할 때 해당 Task만 `In Progress`로 관리하고 체크박스는 비워 둔다.
- 구현, 자동화 테스트, 필요한 문서 갱신이 모두 끝난 뒤에만 `[x]`로 변경한다.
- 각 Phase의 `완료 게이트`를 모두 통과하기 전 다음 Phase의 기능 구현을 본격적으로 시작하지 않는다.
- 기술 spike는 결과가 실패여도 검증 내용과 후속 결정을 ADR에 기록하면 완료할 수 있다.
- 범위나 보안 경계가 바뀌면 관련 명세와 위협 모델을 같은 변경에서 갱신한다.
- 체크박스 완료 근거는 PR, commit, 테스트 결과 또는 결정 문서로 추적 가능해야 한다.

일정은 개인 개발 속도에 따라 달라지므로 날짜 추정보다 의존성과 검증 가능한 결과를 우선한다.

## 2. MVP 완료 정의

아래 사용자 흐름이 macOS, Windows, Linux에서 안정적으로 동작하면 데스크톱 MVP 기능 완료로 판단한다.

```text
앱 실행 및 Vault 잠금 해제
→ PostgreSQL 연결 프로필 생성
→ TLS 연결
→ 객체 탐색
→ Query Tab에서 SQL 실행
→ 현재 Result Tab 교체 또는 새 Result Tab 생성
→ 결과 탐색·복사
→ 안전한 결과 편집 또는 TSV 행 추가
→ 변경 SQL 확인 및 트랜잭션 저장
→ 탭과 연결 종료 시 민감 데이터 정리
```

Android와 iOS는 MVP에서 정식 배포하지 않지만 build, 핵심 responsive 화면, 터치 입력과 외장 키보드 smoke test를 통과해야 한다.

## 3. Phase 진행 현황

- [ ] Phase 0 — 프로젝트 기반과 기술 위험 제거
- [ ] Phase 1 — 애플리케이션 Shell과 디자인 시스템
- [ ] Phase 2 — 보안 연결과 자격 증명
- [ ] Phase 3 — Query Editor와 PostgreSQL 실행 Vertical Slice
- [ ] Phase 4 — PostgreSQL 타입과 Result Grid
- [ ] Phase 5 — Connection·Query·Result 멀티탭 워크스페이스
- [ ] Phase 6 — Object Explorer와 Table Data
- [ ] Phase 7 — 데이터 편집과 TSV 레코드 생성
- [ ] Phase 8 — 모바일 대응과 접근성
- [ ] Phase 9 — 보안·성능·복구 Hardening
- [ ] Phase 10 — 플랫폼 패키징과 MVP 릴리스

## 4. Milestone

| Milestone | 포함 Phase | 결과 |
| --- | --- | --- |
| M0 개발 기준선 | Phase 0 | 모든 개발자가 같은 명령으로 build와 test 가능 |
| M1 Secure Shell | Phase 1~2 | 안전하게 PostgreSQL 연결 프로필 생성 및 연결 가능 |
| M2 Read-only Alpha | Phase 3~6 | SQL 실행, 멀티 결과 비교, 객체 및 테이블 탐색 가능 |
| M3 Editable Beta | Phase 7 | 결과 편집과 TSV insert를 안전하게 저장 가능 |
| M4 Cross-platform RC | Phase 8~9 | 모바일 대응, 접근성, 보안 및 성능 기준 통과 |
| M5 MVP Stable | Phase 10 | 서명된 Tier 1 데스크톱 artifact 배포 가능 |

---

## Phase 0 — 프로젝트 기반과 기술 위험 제거

### 목표

React/Tauri/Rust 프로젝트가 모든 대상 플랫폼에서 반복 가능하게 build되고, 구현 후반에 구조를 뒤집을 수 있는 기술 위험을 작은 spike로 먼저 검증한다.

### 0.1 저장소와 Toolchain

- [ ] `pnpm` workspace와 package metadata를 생성한다.
- [ ] Vite, React, TypeScript 프로젝트를 생성한다.
- [ ] Tauri 2 Rust 프로젝트를 생성하고 desktop target을 연결한다.
- [ ] Tauri Android/iOS target을 초기화한다.
- [ ] Node, pnpm, Rust 최소 버전을 저장소 설정에 고정한다.
- [ ] `pnpm-lock.yaml`과 `Cargo.lock`을 생성하고 버전 관리한다.
- [ ] TypeScript `strict`와 사용하지 않는 코드 검사를 활성화한다.
- [ ] Rust formatting, Clippy와 warning 정책을 설정한다.
- [ ] formatter, lint, typecheck, unit test, integration test, build 명령을 root script로 통일한다.
- [ ] `.gitignore`, `.editorconfig`와 안전한 예제 환경 설정 파일을 추가한다.
- [ ] 비밀값을 요구하는 개발 설정은 환경 변수 이름만 문서화하고 실제 값을 저장소에 넣지 않는다.

### 0.2 기본 디렉터리와 의존성 규칙

- [ ] [아키텍처 문서](../architecture/architecture.md)의 `app`, `features`, `entities`, `shared` frontend 경계를 만든다.
- [ ] Rust의 `commands`, `application`, `domain`, `infrastructure` module 경계를 만든다.
- [ ] feature 간 순환 import를 검사할 lint rule 또는 dependency test를 추가한다.
- [ ] React UI가 SQLx나 credential 구현 세부사항을 참조하지 못하도록 경계를 고정한다.
- [ ] PostgreSQL 구현이 `DatabaseTransport` application contract 뒤에 위치하도록 skeleton을 만든다.
- [ ] frontend와 Rust의 공통 오류 code naming 규칙을 추가한다.

### 0.3 Frontend 기반 의존성

- [ ] TanStack Router를 설치하고 root route를 구성한다.
- [ ] TanStack Query provider와 QueryClient 기본 정책을 구성한다.
- [ ] TanStack Table과 TanStack Virtual을 설치한다.
- [ ] TanStack Form을 설치하고 공통 form adapter 위치를 만든다.
- [ ] Tailwind CSS와 container query 사용 환경을 구성한다.
- [ ] CodeMirror 6와 SQL language package를 설치한다.
- [ ] UI 아이콘은 앱 bundle에 포함되는 단일 icon set으로 제한한다.
- [ ] production build에 Devtools가 포함되지 않는 검증을 추가한다.

### 0.4 Test Harness

- [ ] TypeScript unit test runner와 React component test 환경을 구성한다.
- [ ] Rust unit test와 integration test 디렉터리를 구성한다.
- [ ] disposable PostgreSQL을 실행할 container 기반 test harness를 만든다.
- [ ] PostgreSQL schema, type, constraint, trigger, RLS fixture migration을 만든다.
- [ ] desktop E2E runner가 Tauri test build를 실행할 수 있게 구성한다.
- [ ] viewport별 web UI component test 환경을 구성한다.
- [ ] test log에도 credential과 SQL result가 남지 않도록 기본 redaction을 적용한다.

### 0.5 기술 Spike

- [ ] SQLx에서 dynamic column type과 origin table/column metadata를 얻는 범위를 검증한다.
- [ ] SQLx row stream을 Tauri Channel로 10,000행 전달하고 메모리와 latency를 측정한다.
- [ ] 2개 이하 unacknowledged chunk를 유지하는 backpressure prototype을 검증한다.
- [ ] PostgreSQL cancel protocol과 query session 강제 종료를 검증한다.
- [ ] Query Tab별 session affinity에서 transaction, temp table과 `SET` 유지 여부를 검증한다.
- [ ] PostgreSQL statement 경계를 안전하게 판별할 parser 후보를 desktop/mobile에서 build 검증한다.
- [ ] Rust type에서 TypeScript IPC binding을 생성하는 도구를 비교하고 하나를 확정한다.
- [ ] Stronghold와 OS secure storage 조합을 macOS, Windows, Linux에서 검증한다.
- [ ] Android/iOS에서 secure storage와 PostgreSQL TLS dependency가 build되는지 검증한다.
- [ ] TanStack Table과 Virtual로 10,000행·100열 Grid prototype의 스크롤 예산을 측정한다.
- [ ] spike 결과로 기존 ADR을 보완하거나 새로운 ADR을 작성한다.

### 0.6 CI 기준선

- [ ] pull request에서 frontend lint, typecheck와 unit test를 실행한다.
- [ ] pull request에서 Rust fmt, Clippy와 unit test를 실행한다.
- [ ] PostgreSQL integration test job을 구성한다.
- [ ] macOS, Windows, Linux build matrix를 구성한다.
- [ ] dependency vulnerability와 license scan을 구성한다.
- [ ] generated IPC binding에 미반영 diff가 있으면 CI가 실패하도록 한다.
- [ ] CI artifact와 log에 비밀값이 없는지 검사한다.

### Phase 0 완료 게이트

- [ ] 깨끗한 checkout에서 문서화된 단일 절차로 desktop 앱이 실행된다.
- [ ] Tier 1 desktop 세 플랫폼에서 빈 shell build가 성공한다.
- [ ] Android와 iOS debug build smoke test가 성공한다.
- [ ] 실제 PostgreSQL integration test 한 건이 CI에서 통과한다.
- [ ] 기술 spike의 모든 결정과 제약이 ADR 또는 명세에 반영됐다.
- [ ] remote Tauri capability가 없고 최소 CSP가 적용됐다.

---

## Phase 1 — 애플리케이션 Shell과 디자인 시스템

### 목표

실제 데이터가 없어도 Connection, Object Sidebar, Work Tab, Query Editor와 Result 영역의 정보 구조를 desktop과 compact viewport에서 검증할 수 있게 한다.

### 1.1 Design Token과 공통 UI

- [ ] [디자인 시스템](../spec/design_system.md)의 semantic color token을 Tailwind theme에 구현한다.
- [ ] Light, Dark, System theme 전환과 초기 theme 결정을 구현한다.
- [ ] compact와 comfortable density token을 구현한다.
- [ ] spacing, typography, radius, border, elevation token을 구현한다.
- [ ] focus ring, disabled, destructive, read-only와 production 상태 token을 구현한다.
- [ ] Button, IconButton, Input, Select, Checkbox, Badge와 Tooltip을 구현한다.
- [ ] Dialog, Popover, Menu, Toast, Sheet와 Bottom Sheet의 accessible primitive를 구현한다.
- [ ] Skeleton, Empty State, Error State와 Loading State를 구현한다.
- [ ] 모든 아이콘 버튼에 accessible name과 tooltip을 제공한다.

### 1.2 Application Shell

- [ ] Connection Rail, Object Sidebar, Main Workspace와 Status Bar 4개 영역을 구현한다.
- [ ] desktop resizable sidebar와 main split panel을 구현한다.
- [ ] panel 최소·최대 크기와 마지막 크기 상태를 정의한다.
- [ ] 좁은 viewport에서 Object Sidebar가 Drawer로 전환되게 한다.
- [ ] connection이 없는 첫 실행 empty state를 구현한다.
- [ ] 연결 중, 연결 실패, offline과 locked shell 상태를 구현한다.
- [ ] active environment, read-only와 TLS 상태가 색상 외 텍스트로 표현되게 한다.

### 1.3 Workspace 상태 모델

- [ ] `WorkspaceState`, `ConnectionWorkspace`, `WorkTab`과 `ResultTab` TypeScript type을 정의한다.
- [ ] workspace reducer의 action과 invariant를 정의한다.
- [ ] active connection, active work tab과 active result tab 상태를 분리한다.
- [ ] Query Tab, Table Data Tab과 Table Structure Tab 기본 모델을 정의한다.
- [ ] preview tab과 pinned tab 상태를 정의한다.
- [ ] dirty, running, pinned와 exporting 보호 상태를 정의한다.
- [ ] 보호된 탭을 닫거나 교체할 때 확인 workflow를 구현한다.
- [ ] 예상하지 못한 reducer action과 상태 손상을 개발 환경에서 탐지한다.

### 1.4 Tab과 Command UI

- [ ] Connection Workspace switcher UI를 구현한다.
- [ ] Work Tab bar의 생성, 선택, 이름 변경과 닫기 UI를 구현한다.
- [ ] Result Tab bar의 선택, pin과 닫기 UI skeleton을 구현한다.
- [ ] Query Toolbar에 `Run`, `Run in New Result`, `Stop`과 menu 위치를 구현한다.
- [ ] 앱 내부 command registry와 shortcut dispatch 계층을 구현한다.
- [ ] shortcut 충돌, text composition과 platform modifier 규칙을 정의한다.
- [ ] 모든 command에 keyboard와 pointer/touch 진입점을 제공한다.
- [ ] route에는 정적 화면만 두고 동적 tab은 workspace state에 유지한다.

### 1.5 Shell 검증

- [ ] 360×800 viewport component test를 작성한다.
- [ ] 768×1024 viewport component test를 작성한다.
- [ ] 1024×640 viewport component test를 작성한다.
- [ ] 1440×900 viewport component test를 작성한다.
- [ ] keyboard만으로 Rail, Sidebar, Work Tab과 Result Tab을 이동하는 test를 작성한다.
- [ ] theme와 density 전환 visual regression 기준을 만든다.
- [ ] reduced motion과 고대비 상태를 수동 검증한다.

### Phase 1 완료 게이트

- [ ] 실제 DB 없이 전체 화면 hierarchy를 탐색할 수 있다.
- [ ] desktop에서 Sidebar, Editor와 Result panel 크기를 조절할 수 있다.
- [ ] mobile viewport에서 같은 정보 구조가 Drawer와 mode switch로 표현된다.
- [ ] dirty 또는 pinned placeholder 결과가 조용히 닫히거나 교체되지 않는다.
- [ ] 주요 UI가 키보드와 touch 양쪽에서 접근 가능하다.

---

## Phase 2 — 보안 연결과 자격 증명

### 목표

비밀값을 React와 일반 설정 파일에 남기지 않고 PostgreSQL 연결 프로필을 생성, 테스트, 저장, 열기, 잠금 및 삭제할 수 있게 한다.

### 2.1 Vault와 Secret 저장

- [ ] `vault_status`, `vault_initialize`, `vault_unlock`, `vault_lock` command를 구현한다.
- [ ] OS secure storage에서 vault wrapping key를 저장·조회하는 adapter를 구현한다.
- [ ] Linux Secret Service가 없을 때 master password fallback을 구현한다.
- [ ] 비밀번호와 client private key를 Stronghold 기반 encrypted vault에 저장한다.
- [ ] React에는 secret 대신 opaque `credentialId`만 반환한다.
- [ ] password 입력 성공 후 form state와 temporary buffer를 제거한다.
- [ ] idle timeout과 수동 잠금을 구현한다.
- [ ] 앱 background 또는 OS lock 시 privacy lock 정책을 연결한다.
- [ ] vault migration version과 실패 복구 경로를 구현한다.

### 2.2 Connection Profile 영속성

- [ ] versioned profile schema를 구현한다.
- [ ] `connection_profile_list`, `save`, `delete` command를 구현한다.
- [ ] profile에 host, port, database, username과 credential reference만 저장한다.
- [ ] profile name, environment, color token, read-only와 timeout 설정을 저장한다.
- [ ] profile JSON에 password, private key와 connection string이 없는 test를 작성한다.
- [ ] profile 삭제 시 연결, credential과 관련 workspace 처리 순서를 구현한다.
- [ ] 저장 실패와 부분 실패 시 원래 profile을 보존한다.

### 2.3 TLS와 인증서

- [ ] TLS 기본값을 `verify-full`로 고정한다.
- [ ] system CA와 hostname 검증을 구현한다.
- [ ] 사용자 CA certificate import command를 구현한다.
- [ ] client certificate와 private key import를 구현한다.
- [ ] 인증서 file path 대신 관리되는 credential handle을 저장한다.
- [ ] `verify-ca` 선택 시 차이를 설명하는 경고를 제공한다.
- [ ] `insecure` 선택 시 명시적 재확인과 상태 badge를 제공한다.
- [ ] 인증서 만료, 잘못된 hostname과 신뢰되지 않은 CA 오류를 구분한다.

### 2.4 Connection Manager

- [ ] `connection_test`, `open`, `close`, `status` command를 구현한다.
- [ ] `ConnectionManager`가 connection별 control pool을 소유하게 한다.
- [ ] profile별 최대 connection과 idle timeout을 적용한다.
- [ ] 연결 상태 machine을 `closed`, `connecting`, `connected`, `error`, `locked`로 구현한다.
- [ ] 연결 재시도는 사용자 동작 또는 제한된 backoff로만 수행한다.
- [ ] 같은 profile 중복 open을 idempotent하게 처리한다.
- [ ] vault lock 시 모든 Query session과 control pool을 종료한다.
- [ ] connection string을 Rust 내부에서만 조립한다.
- [ ] server version, latency와 TLS 상태를 비민감 status로 반환한다.

### 2.5 Connection UI

- [ ] TanStack Form으로 profile 생성·편집 form을 구현한다.
- [ ] host, port, database와 username validation을 구현한다.
- [ ] password 저장 여부와 vault 동작을 명확히 표시한다.
- [ ] 연결 테스트 진행, 성공과 원인별 실패 상태를 구현한다.
- [ ] 사용자 CA와 client certificate 선택 UI를 구현한다.
- [ ] read-only, environment와 Safe Mode 설정 UI를 구현한다.
- [ ] profile 생성 후 Connection Rail에 workspace를 추가한다.
- [ ] 연결 삭제 및 credential 삭제 범위를 확인하는 dialog를 구현한다.

### 2.6 보안 및 통합 테스트

- [ ] 올바른 `verify-full` 연결 integration test를 작성한다.
- [ ] hostname mismatch가 실패하는 test를 작성한다.
- [ ] 신뢰되지 않은 CA와 만료 인증서 test를 작성한다.
- [ ] 잘못된 password와 권한 부족 오류 redaction test를 작성한다.
- [ ] vault lock 후 command 접근이 거부되는 test를 작성한다.
- [ ] 일반 설정, URL, frontend cache와 log secret scan test를 작성한다.
- [ ] capability가 connection 관련 command만 허용하는지 검증한다.

### Phase 2 완료 게이트

- [ ] 사용자가 profile을 생성하고 TLS 연결 테스트 후 다시 열 수 있다.
- [ ] 저장된 파일과 log 어디에도 평문 password나 private key가 없다.
- [ ] `verify-full` 실패를 우회하지 않고 정확한 해결 정보를 표시한다.
- [ ] vault를 잠그면 모든 DB 연결과 민감 UI가 닫힌다.
- [ ] profile create, edit, delete와 connection lifecycle E2E가 통과한다.

---

## Phase 3 — Query Editor와 PostgreSQL 실행 Vertical Slice

### 목표

Query Tab 하나에서 SQL을 작성하고 `Cmd/Ctrl + Enter`로 실행하여 첫 row chunk부터 결과를 확인하고, timeout 또는 사용자 요청으로 안전하게 취소할 수 있게 한다.

### 3.1 CodeMirror Query Editor

- [ ] SQL syntax highlighting과 PostgreSQL dialect를 구성한다.
- [ ] tab size, line number, wrapping과 font 설정을 구성한다.
- [ ] SQL draft를 controlled rerender 없이 효율적으로 workspace와 동기화한다.
- [ ] selection이 있으면 selection을 실행 대상으로 추출한다.
- [ ] selection이 없으면 cursor가 포함된 statement를 parser로 추출한다.
- [ ] string, dollar quote, comment와 semicolon 경계를 정확히 처리한다.
- [ ] 빈 statement와 MVP에서 금지한 다중 statement를 UI에서 차단한다.
- [ ] parser 오류 위치를 editor diagnostic으로 표시한다.
- [ ] IME composition 중 shortcut 실행을 방지한다.

### 3.2 Query Session

- [ ] `query_session_open`, `close`, `rollback`, `force_close` command를 구현한다.
- [ ] Query Tab 첫 실행 시 전용 PostgreSQL session을 lazy하게 생성한다.
- [ ] 같은 Query Tab의 후속 실행이 동일 session을 사용하게 한다.
- [ ] Query Tab당 동시 실행을 하나로 제한한다.
- [ ] 서로 다른 Query Tab session은 동시에 실행 가능하게 한다.
- [ ] desktop 최대 8개, mobile 최대 3개 session 정책을 적용한다.
- [ ] `BEGIN`, `COMMIT`, `ROLLBACK`, temp table과 `SET` 상태를 유지한다.
- [ ] 열린 transaction과 aborted transaction 상태를 감지해 UI에 전달한다.
- [ ] dirty transaction이 있는 탭 close workflow를 구현한다.

### 3.3 Query 실행 Protocol

- [ ] `query_execute` command와 `QueryExecuteRequest` validation을 구현한다.
- [ ] execution마다 불투명한 `executionId`를 생성한다.
- [ ] `started`, `columns`, `rows`, `notice`, `command`, terminal event를 구현한다.
- [ ] event sequence가 증가하고 terminal event가 정확히 한 번 발생하게 한다.
- [ ] 첫 chunk 50행, 이후 기본 100행 전송을 구현한다.
- [ ] chunk당 soft 1MiB 제한을 구현한다.
- [ ] `query_ack_chunk`와 최대 2개 unacked chunk backpressure를 구현한다.
- [ ] 기본 500행과 최대 10,000행 제한을 구현한다.
- [ ] row limit 도달과 command affected row를 구분해 표시한다.
- [ ] WebView가 dispose된 execution의 stream을 즉시 정리한다.

### 3.4 실행과 결과 UI

- [ ] 첫 실행 시 `Result 1`을 생성한다.
- [ ] 기본 실행이 active unprotected Result Tab을 교체하게 한다.
- [ ] running, columns received, streaming, success, error와 cancelled 상태를 구현한다.
- [ ] 실행 SQL, 실행 시각, duration, row count와 limit 상태를 표시한다.
- [ ] PostgreSQL notice를 접을 수 있는 message 영역에 표시한다.
- [ ] syntax, network, timeout, permission과 server 오류를 구분한다.
- [ ] 오류 position을 editor와 연동한다.
- [ ] Result Tab dispose 시 row buffer와 Rust handle을 해제한다.

### 3.5 Timeout과 Cancellation

- [ ] 기본 60초 timeout과 profile별 override를 적용한다.
- [ ] `Esc`와 `Cmd/Ctrl + .` cancel command를 구현한다.
- [ ] control pool을 사용해 대상 backend만 cancel한다.
- [ ] cancel 응답 후 query terminal event를 기다린다.
- [ ] 2초 내 종료되지 않으면 해당 Query session만 강제 종료한다.
- [ ] cancel race와 이미 종료된 execution 요청을 idempotent하게 처리한다.
- [ ] 다른 Query Tab의 실행이 영향을 받지 않는지 검증한다.

### 3.6 Safe Mode와 오류 안전성

- [ ] read-only profile session에 `default_transaction_read_only`를 적용한다.
- [ ] parser 결과로 파괴적 statement 경고 대상을 판정한다.
- [ ] `DROP`, `TRUNCATE`, 광범위한 `UPDATE/DELETE` 확인 dialog를 구현한다.
- [ ] Safe Mode가 DB 권한을 대체하지 않는다는 안내를 표시한다.
- [ ] command input 크기와 timeout 범위를 IPC에서 검증한다.
- [ ] error detail에서 credential, file path와 connection string을 redact한다.

### 3.7 실행 테스트

- [ ] selection 우선 실행 unit test를 작성한다.
- [ ] comment, quote, dollar quote가 포함된 statement boundary test를 작성한다.
- [ ] session affinity transaction integration test를 작성한다.
- [ ] temp table과 `SET search_path` 유지 test를 작성한다.
- [ ] 500행 chunk sequence와 ack contract test를 작성한다.
- [ ] timeout, cancel, force close와 cross-tab isolation test를 작성한다.
- [ ] connection loss 중 exactly-one terminal event test를 작성한다.
- [ ] 첫 Query 실행 desktop E2E를 작성한다.

### Phase 3 완료 게이트

- [ ] 첫 vertical slice가 실제 PostgreSQL을 대상으로 E2E 통과한다.
- [ ] `Cmd/Ctrl + Enter`가 선택 SQL 또는 현재 statement만 실행한다.
- [ ] 500행 결과가 전체 완료를 기다리지 않고 첫 chunk부터 보인다.
- [ ] cancel과 timeout이 다른 Query Tab에 영향을 주지 않는다.
- [ ] 탭을 닫은 뒤 session, channel과 row buffer가 남지 않는다.

---

## Phase 4 — PostgreSQL 타입과 Result Grid

### 목표

PostgreSQL 값을 정밀도 손실 없이 수신하고, 대용량 결과를 키보드·마우스·터치로 탐색·선택·복사할 수 있는 Grid를 완성한다.

### 4.1 손실 없는 `DbValue`

- [ ] [PostgreSQL 타입 명세](../spec/postgresql_type_spec.md)의 tagged union을 Rust에 구현한다.
- [ ] generated TypeScript `DbValue` binding을 생성한다.
- [ ] `int2`, `int4`, `int8`을 정밀도 손실 없는 문자열로 전달한다.
- [ ] `numeric`, `decimal`, `float4`, `float8`과 특수값을 문자열로 전달한다.
- [ ] boolean, text, char, varchar와 enum을 변환한다.
- [ ] date, time, timetz, timestamp와 timestamptz 의미를 보존한다.
- [ ] UUID, JSON과 JSONB 원문을 보존한다.
- [ ] bytea는 base64와 large value handle 정책을 적용한다.
- [ ] array dimension과 lower bound를 보존한다.
- [ ] domain의 base type과 domain name을 보존한다.
- [ ] network, range, multirange, interval과 money를 처리한다.
- [ ] composite와 extension type은 type name을 포함한 lossless fallback으로 처리한다.
- [ ] SQL `NULL`, 빈 문자열과 default marker를 구분한다.

### 4.2 Column Metadata와 Large Value

- [ ] column index, name, PostgreSQL OID, type name과 nullability를 전달한다.
- [ ] 가능한 경우 source schema, table과 column identity를 전달한다.
- [ ] duplicate column name을 index 기반 identity로 구분한다.
- [ ] 큰 text, JSON과 binary 값을 inline threshold 밖에서 handle로 보관한다.
- [ ] `result_value_fetch`의 offset과 length validation을 구현한다.
- [ ] `result_release`가 모든 large value handle을 제거하게 한다.
- [ ] tab close, connection close와 vault lock cleanup을 연결한다.

### 4.3 Result Store

- [ ] React render tree 밖의 execution별 Result Store를 구현한다.
- [ ] column metadata와 row chunk를 sequence 순서로 append한다.
- [ ] duplicate, missing 또는 out-of-order chunk를 탐지한다.
- [ ] viewport subscription이 필요한 slice만 rerender하게 한다.
- [ ] Result Tab별 memory 사용량을 추적한다.
- [ ] 100MB soft limit 경고와 추가 fetch 중단 workflow를 구현한다.
- [ ] dispose가 subscription, row와 edit buffer를 원자적으로 제거하게 한다.

### 4.4 Grid 렌더링

- [ ] TanStack Table로 column, sizing, pinning과 sorting model을 구성한다.
- [ ] TanStack Virtual로 row virtualization을 구현한다.
- [ ] 넓은 결과를 위한 column virtualization을 구현한다.
- [ ] sticky header와 pinned column을 구현한다.
- [ ] column resize, reorder와 visibility를 구현한다.
- [ ] cell overflow, multiline, JSON과 binary preview renderer를 구현한다.
- [ ] `NULL`, empty, truncated와 error cell을 시각적으로 구분한다.
- [ ] loading, empty, streaming, failed와 cancelled Grid 상태를 구현한다.
- [ ] 10,000행에서도 DOM row 수가 viewport와 overscan 범위에 머물게 한다.

### 4.5 Focus와 Selection

- [ ] active cell, anchor, range와 selected row 상태를 분리한다.
- [ ] click, Shift-click과 drag range selection을 구현한다.
- [ ] Arrow, Page Up/Down, Home/End keyboard navigation을 구현한다.
- [ ] Shift와 modifier 조합 range 확장을 구현한다.
- [ ] Grid focus가 virtualization으로 사라지지 않게 logical focus를 관리한다.
- [ ] screen reader용 row/column 위치와 selection 상태를 제공한다.
- [ ] touch에서 single-cell selection과 scroll gesture가 충돌하지 않게 한다.

### 4.6 Sort, Filter, Copy와 Export

- [ ] arbitrary Query Result에 client-side stable sort를 구현한다.
- [ ] `NULL`, numeric, temporal과 text type별 comparator를 구현한다.
- [ ] client filter가 원본 row identity를 보존하게 한다.
- [ ] 선택 범위 기본 복사를 TSV로 구현한다.
- [ ] header 포함, SQL literal, JSON과 CSV copy option을 구현한다.
- [ ] RFC 4180 CSV와 JSON export를 streaming 방식으로 구현한다.
- [ ] CSV formula injection 방어 option을 기본 활성화한다.
- [ ] binary와 large value copy 전에 명시적 경고를 제공한다.
- [ ] clipboard 작업은 반드시 사용자 gesture에서만 실행한다.

### 4.7 타입·Grid 검증

- [ ] 지원 타입별 database round-trip integration test를 작성한다.
- [ ] timezone과 DST 경계 test를 작성한다.
- [ ] 최대 정밀도 numeric과 64-bit integer test를 작성한다.
- [ ] array lower bound, nested array와 NULL element test를 작성한다.
- [ ] duplicate column, NULL과 empty copy snapshot test를 작성한다.
- [ ] keyboard selection과 TSV copy component test를 작성한다.
- [ ] 10,000행·100열 scroll 성능 benchmark를 추가한다.
- [ ] Result Tab 반복 open/close memory recovery test를 추가한다.

### Phase 4 완료 게이트

- [ ] 주요 PostgreSQL 타입을 표시·복사·재입력해도 의미와 정밀도가 손실되지 않는다.
- [ ] 10,000행 결과가 성능 예산 안에서 스크롤된다.
- [ ] 키보드만으로 Grid 탐색, 범위 선택과 복사가 가능하다.
- [ ] large value와 Result Tab을 닫은 뒤 Rust와 frontend memory가 회수된다.
- [ ] CSV/JSON export에 credential이나 임시 평문 파일이 남지 않는다.

---

## Phase 5 — Connection·Query·Result 멀티탭 워크스페이스

### 목표

여러 Connection Workspace와 Query Tab을 독립적으로 유지하고, 각 Query Tab 안에서 현재 결과 교체와 새 Result Tab 생성을 명확히 제어할 수 있게 한다.

### 5.1 Connection Workspace

- [ ] 연결 profile별 독립적인 Connection Workspace를 생성한다.
- [ ] Connection Rail에서 workspace를 즉시 전환한다.
- [ ] workspace별 active Work Tab과 Sidebar 상태를 보존한다.
- [ ] 서로 다른 connection의 tab, result와 metadata cache가 섞이지 않게 scope를 적용한다.
- [ ] connection close가 해당 workspace의 dirty/running 상태를 확인하게 한다.
- [ ] 세 개 이상의 연결을 동시에 열고 전환하는 E2E를 작성한다.

### 5.2 Work Tab

- [ ] Query, Table Data와 Table Structure tab factory를 구현한다.
- [ ] 새 Query Tab 생성과 기본 이름 규칙을 구현한다.
- [ ] Query Tab rename과 dirty indicator를 구현한다.
- [ ] `Ctrl + Tab`, `Ctrl + Shift + Tab` 다음·이전 tab 이동을 구현한다.
- [ ] `Cmd/Ctrl + 1~9` 직접 이동을 구현한다.
- [ ] tab overflow, scroll과 keyboard roving focus를 구현한다.
- [ ] 닫힌 Query Tab의 session과 execution을 정리한다.
- [ ] preview tab을 double-click 또는 명시적 pin으로 고정하는 동작을 구현한다.

### 5.3 Result Tab

- [ ] `Cmd/Ctrl + Shift + Enter`와 `Run in New Result Tab` command를 구현한다.
- [ ] 새 실행마다 오른쪽에 고유 Result Tab을 추가한다.
- [ ] 기본 실행은 active unprotected result만 교체한다.
- [ ] pinned, dirty, running 또는 exporting result를 보호한다.
- [ ] 보호된 result가 active이면 기본 실행도 새 Result Tab을 만들게 한다.
- [ ] Result Tab rename과 pin/unpin을 구현한다.
- [ ] Result Tab status, row count, duration과 dirty count를 표시한다.
- [ ] Result Tab close confirmation과 resource dispose를 구현한다.
- [ ] Query Tab당 Result Tab 개수와 memory soft limit 경고를 구현한다.
- [ ] 실행 순서와 완료 순서가 달라도 올바른 Result Tab에 event를 연결한다.

### 5.4 Workspace 영속성과 복원

- [ ] versioned workspace snapshot schema를 구현한다.
- [ ] connection별 Query Tab 제목, SQL draft와 순서를 저장한다.
- [ ] active connection과 active tab을 저장한다.
- [ ] panel 크기, theme, density와 shortcut preference를 저장한다.
- [ ] Result row, pending edit와 credential을 snapshot에서 제외한다.
- [ ] debounce와 atomic write를 사용해 draft를 저장한다.
- [ ] schema migration과 손상된 snapshot fallback을 구현한다.
- [ ] crash 후 SQL draft를 복원하고 결과는 빈 상태로 표시한다.
- [ ] vault lock 상태에서는 민감한 workspace 정보를 가린다.

### 5.5 Query History

- [ ] history 저장 여부를 기본값과 함께 설정에 제공한다.
- [ ] 실행 SQL, connection reference, 시각, duration과 status를 encrypted storage에 저장한다.
- [ ] result row와 bind secret을 history에 저장하지 않는다.
- [ ] history 검색, 재열기와 개별·전체 삭제를 구현한다.
- [ ] history disable 시 기존 데이터를 삭제할지 선택하게 한다.
- [ ] size/retention 제한과 오래된 항목 제거를 구현한다.

### 5.6 멀티탭 검증

- [ ] 기본 실행이 현재 result를 교체하는 E2E를 작성한다.
- [ ] 새 결과 실행이 이전 result를 보존하는 E2E를 작성한다.
- [ ] pinned와 dirty result 자동 보호 test를 작성한다.
- [ ] connection별 동시 Query Tab 실행 isolation test를 작성한다.
- [ ] 앱 재시작 후 draft 복원과 result 미복원 test를 작성한다.
- [ ] 10,000행 Result Tab 5개 생성 후 전체 close memory test를 작성한다.

### Phase 5 완료 게이트

- [ ] connection마다 여러 Work Tab을 독립적으로 사용할 수 있다.
- [ ] Query Tab마다 여러 Result Tab을 생성하고 비교할 수 있다.
- [ ] 기본 실행과 새 결과 실행의 shortcut 및 toolbar 동작이 일치한다.
- [ ] 보호된 결과와 미저장 작업이 명시적 확인 없이 유실되지 않는다.
- [ ] 앱 재시작 시 SQL draft만 안전하게 복원된다.

---

## Phase 6 — Object Explorer와 Table Data

### 목표

왼쪽 Sidebar에서 PostgreSQL 객체를 빠르게 찾고, table을 열어 server-side pagination으로 데이터를 탐색할 수 있게 한다.

### 6.1 Metadata Catalog

- [ ] `metadata_list_schemas`, `metadata_list_objects`, `metadata_get_table` command를 구현한다.
- [ ] schema, table, view, materialized view와 function 기본 metadata를 조회한다.
- [ ] column, type, nullable, default, primary key, unique key와 foreign key를 조회한다.
- [ ] index, trigger, RLS와 privilege metadata를 조회한다.
- [ ] catalog identifier를 schema와 name으로 안전하게 quote한다.
- [ ] 권한이 없는 객체는 전체 탐색 실패 대신 제한 상태로 반환한다.
- [ ] metadata cache key에 connection, database와 schema를 포함한다.
- [ ] refresh와 connection change 시 TanStack Query cache를 정확히 invalidate한다.

### 6.2 Object Sidebar

- [ ] TablePlus에서 참고한 schema/object group hierarchy를 구현한다.
- [ ] schema collapse, expand와 마지막 상태 저장을 구현한다.
- [ ] object 이름 fuzzy search를 구현한다.
- [ ] system schema 표시 toggle을 구현한다.
- [ ] pinned object와 recent object 영역을 구현한다.
- [ ] refresh, open data, open structure와 new query context menu를 구현한다.
- [ ] loading, permission denied, empty schema와 disconnected 상태를 구현한다.
- [ ] 대규모 schema에서도 search 성능 예산을 지키게 한다.
- [ ] Sidebar 전체를 keyboard와 screen reader로 탐색 가능하게 한다.

### 6.3 Preview와 Table Structure Tab

- [ ] object single-click이 재사용 가능한 preview tab을 열게 한다.
- [ ] double-click 또는 pin이 고정 Work Tab으로 전환하게 한다.
- [ ] Table Structure Tab에 column, key, index와 relation을 표시한다.
- [ ] 객체 이름과 schema를 header와 breadcrumb에 표시한다.
- [ ] metadata refresh 후 제거되거나 변경된 객체 상태를 처리한다.

### 6.4 Table Data

- [ ] Table Data 전용 query builder를 Rust에 구현한다.
- [ ] identifier는 catalog metadata로 검증하고 안전하게 quote한다.
- [ ] value filter는 모두 bind parameter로 전달한다.
- [ ] 기본 page size와 cursor/offset pagination 정책을 구현한다.
- [ ] server-side column sort를 구현한다.
- [ ] type-aware server-side filter를 구현한다.
- [ ] total count는 자동 full count 대신 사용자 요청 또는 추정값 정책을 적용한다.
- [ ] hidden primary key와 `xmin`을 row identity로 함께 조회한다.
- [ ] Table Data refresh가 pending edit이 있을 때 확인을 요구하게 한다.
- [ ] streaming Query Result와 paginated Table Data의 Grid adapter를 분리한다.

### 6.5 Explorer 검증

- [ ] 권한이 다른 PostgreSQL role fixture test를 작성한다.
- [ ] reserved word와 특수문자 identifier test를 작성한다.
- [ ] 복합 primary key table data test를 작성한다.
- [ ] RLS가 적용된 table 조회 test를 작성한다.
- [ ] server sort/filter/pagination 중복·누락 row test를 작성한다.
- [ ] large schema search benchmark를 작성한다.
- [ ] object preview와 pin E2E를 작성한다.

### Phase 6 완료 게이트

- [ ] Sidebar에서 schema와 object를 검색하고 열 수 있다.
- [ ] 권한이 부족한 객체가 있어도 나머지 탐색이 동작한다.
- [ ] Table Data를 server-side pagination, sort와 filter로 탐색할 수 있다.
- [ ] 특수문자 identifier에서도 생성 SQL이 안전하다.
- [ ] Table Data row에 편집을 위한 PK와 version identity가 준비된다.

---

## Phase 7 — 데이터 편집과 TSV 레코드 생성

### 목표

안전하게 원본 row를 식별할 수 있는 결과만 편집하고, 셀 변경과 스프레드시트 TSV 붙여넣기를 미리 확인한 뒤 하나의 transaction으로 저장할 수 있게 한다.

### 7.1 편집 가능성 판정

- [ ] Table Data에서 primary key와 `xmin` 존재 여부를 확인한다.
- [ ] Query Result의 single base table과 direct column projection을 판정한다.
- [ ] Query Result에 모든 primary key column이 포함됐는지 확인한다.
- [ ] JOIN, CTE, aggregate, `DISTINCT`, set operation과 expression column을 읽기 전용으로 판정한다.
- [ ] view, materialized view와 origin 불명 column을 읽기 전용으로 판정한다.
- [ ] 편집 불가 이유를 사용자에게 구체적으로 표시한다.
- [ ] 판정 오류 시 쓰기 가능보다 읽기 전용을 선택한다.

### 7.2 Edit Buffer와 Cell Editor

- [ ] 원본값과 변경값을 분리한 edit buffer를 구현한다.
- [ ] cell별 unchanged, modified, invalid와 conflict 상태를 구현한다.
- [ ] text, numeric, boolean, temporal, enum, JSON과 NULL editor를 구현한다.
- [ ] binary, array와 large value는 명시적 전문 editor를 제공하거나 MVP 읽기 전용으로 처리한다.
- [ ] desktop double-click/Enter inline editing을 구현한다.
- [ ] Esc 취소와 Enter/Tab commit-to-buffer 동작을 구현한다.
- [ ] 여러 cell 변경의 undo와 discard를 구현한다.
- [ ] refresh, sort, filter, tab close 전 pending edit 보호를 구현한다.

### 7.3 생성 SQL과 Preview

- [ ] 변경 모델을 `changes_preview` IPC request로 직렬화한다.
- [ ] schema, table과 column identifier를 catalog metadata로 검증한다.
- [ ] 모든 value를 bind parameter로 생성한다.
- [ ] UPDATE, INSERT와 DELETE statement builder를 구현한다.
- [ ] SQL Preview에 identifier SQL과 redacted parameter summary를 표시한다.
- [ ] generated SQL을 사용자가 임의 문자열로 재편집하지 못하게 한다.
- [ ] Preview와 실제 commit이 동일한 normalized change set을 사용하게 한다.
- [ ] empty change와 중복 row change를 사전에 거부한다.

### 7.4 UPDATE와 DELETE

- [ ] primary key 전체를 UPDATE/DELETE `WHERE`에 사용한다.
- [ ] Table Data에서는 `xmin`을 optimistic locking 조건에 추가한다.
- [ ] Query Result fallback에서는 원래 반환 column 값을 lock 조건으로 사용한다.
- [ ] 영향받은 row가 정확히 1개인지 검증한다.
- [ ] 0개면 conflict, 2개 이상이면 invariant violation으로 전체 rollback한다.
- [ ] row delete는 별도 destructive confirmation을 제공한다.
- [ ] primary key 자체 변경 전후 identity 처리를 구현한다.
- [ ] trigger가 값을 바꾸면 `RETURNING` 결과로 Grid를 갱신한다.

### 7.5 INSERT와 TSV Paste

- [ ] clipboard TSV parser를 quoted newline과 platform line ending에 맞게 구현한다.
- [ ] selection 시작 cell 기준 rectangular mapping을 구현한다.
- [ ] 신규 row 영역에 header 포함 여부를 선택하게 한다.
- [ ] `NULL`, 빈 문자열과 `DEFAULT` marker를 구분한다.
- [ ] column별 type parsing과 validation을 구현한다.
- [ ] generated/default/identity column 포함 여부를 처리한다.
- [ ] 10,000 cells와 transaction당 500행 제한을 적용한다.
- [ ] Import Preview에서 row, column, parsed value와 오류를 표시한다.
- [ ] 일부만 저장하지 않고 전체 batch를 한 transaction으로 처리한다.
- [ ] `RETURNING` row를 원래 paste 순서에 맞춰 Grid에 추가한다.

### 7.6 Commit과 Conflict

- [ ] `changes_commit`을 Query 실행과 분리된 명시적 transaction으로 구현한다.
- [ ] 한 Result Tab의 모든 변경을 원자적으로 commit한다.
- [ ] constraint, permission, RLS와 trigger 오류를 row/column에 연결한다.
- [ ] 실패 시 transaction 전체를 rollback하고 edit buffer를 보존한다.
- [ ] optimistic conflict에서 local, original과 current DB value를 표시한다.
- [ ] conflict별 reload, keep local 재시도와 discard 선택을 구현한다.
- [ ] 자동 force overwrite를 제공하지 않는다.
- [ ] connection loss 시 commit 결과 불명 상태를 감지하고 재확인 절차를 제공한다.
- [ ] commit request에 idempotency key를 적용한다.

### 7.7 편집 보안 및 테스트

- [ ] identifier quoting property test를 작성한다.
- [ ] value가 SQL text에 합쳐지지 않는 integration test를 작성한다.
- [ ] 복합 PK, nullable unique, RLS, trigger와 generated column test를 작성한다.
- [ ] concurrent UPDATE conflict test를 작성한다.
- [ ] 100행 TSV paste 성공과 원자적 rollback test를 작성한다.
- [ ] malformed TSV와 10,000 cells limit test를 작성한다.
- [ ] formula-like value가 CSV export에서 안전하게 처리되는지 test한다.
- [ ] Table Data와 simple Query Result 편집 E2E를 작성한다.

### Phase 7 완료 게이트

- [ ] 안전하게 식별 가능한 결과만 편집 가능하다.
- [ ] 모든 생성 쓰기 SQL이 identifier validation과 bind parameter를 사용한다.
- [ ] 변경 SQL을 preview하고 transaction으로 저장 또는 전체 취소할 수 있다.
- [ ] 동시 수정은 자동 덮어쓰기 없이 conflict로 표시된다.
- [ ] 100행 TSV 붙여넣기가 원자적으로 성공하거나 전체 rollback된다.

---

## Phase 8 — 모바일 대응과 접근성

### 목표

데스크톱에서 완성된 정보 구조를 작은 화면과 touch 입력에 맞게 재배치하고, 키보드와 보조 기술 사용자가 핵심 기능을 사용할 수 있게 한다.

### 8.1 Responsive Layout

- [ ] viewport가 아니라 실제 container 크기를 기준으로 panel 변형을 적용한다.
- [ ] phone에서 Connection Switcher를 Sheet로 구현한다.
- [ ] Object Sidebar를 full-height Drawer로 구현한다.
- [ ] Editor와 Results를 segmented mode로 전환하게 한다.
- [ ] Result Tab overflow를 horizontal scroll과 menu로 처리한다.
- [ ] query 실행과 cancel을 mobile action bar에 제공한다.
- [ ] safe area, dynamic viewport height와 on-screen keyboard를 처리한다.
- [ ] tablet에서 Sidebar와 editor/result split을 동시에 사용할 수 있게 한다.

### 8.2 Touch Editing과 Clipboard

- [ ] cell tap과 scroll gesture 충돌을 해결한다.
- [ ] cell 편집을 Bottom Sheet 또는 full-screen editor로 구현한다.
- [ ] row 전체 상세 편집 화면을 구현한다.
- [ ] TSV 붙여넣기 Import Sheet를 mobile flow로 구현한다.
- [ ] clipboard permission과 user gesture 제한을 처리한다.
- [ ] export는 platform document picker 또는 share sheet를 사용한다.
- [ ] touch target과 density가 접근성 크기 기준을 충족하게 한다.
- [ ] hover에서만 접근 가능한 action이 없는지 검증한다.

### 8.3 Mobile Runtime과 Privacy

- [ ] Android 12+ arm64 debug build를 실제 emulator/device에서 실행한다.
- [ ] iOS 16+ arm64 build를 simulator/device에서 실행한다.
- [ ] VPN/private network 안의 direct PostgreSQL 연결 smoke test를 수행한다.
- [ ] mobile direct connection을 Experimental로 명확히 표시한다.
- [ ] app background 전환 시 민감 화면 preview를 가린다.
- [ ] background 중 query와 connection lifecycle 정책을 적용한다.
- [ ] mobile secure storage와 vault unlock을 검증한다.
- [ ] 일반 public mobile DB 연결에는 Gateway가 필요하다는 안내를 유지한다.

### 8.4 Keyboard와 Screen Reader

- [ ] 모든 주요 action에 visible focus를 제공한다.
- [ ] Work Tab과 Result Tab에 올바른 tab semantics를 적용한다.
- [ ] Grid에 row/column header와 active cell 정보를 제공한다.
- [ ] loading, query completion, error와 conflict를 live region으로 알린다.
- [ ] 상태가 색상만으로 전달되지 않는지 검사한다.
- [ ] reduced motion과 high contrast를 검증한다.
- [ ] macOS VoiceOver와 Windows NVDA smoke test를 수행한다.
- [ ] iOS VoiceOver와 Android TalkBack smoke test를 수행한다.
- [ ] 외장 mobile keyboard에서 query와 tab shortcut을 검증한다.

### Phase 8 완료 게이트

- [ ] 360×800과 768×1024에서 핵심 flow가 가로 잘림 없이 완료된다.
- [ ] touch만으로 연결, 쿼리 실행, 결과 탐색과 row 편집이 가능하다.
- [ ] 모든 shortcut 기능에 touch/pointer 대안이 있다.
- [ ] keyboard만으로 desktop MVP 전체 핵심 flow를 완료할 수 있다.
- [ ] Android/iOS build와 responsive E2E smoke가 통과한다.

---

## Phase 9 — 보안·성능·복구 Hardening

### 목표

기능 완료 상태를 보안 기준선, 성능 예산, 장애 복구와 지원 PostgreSQL version matrix에 맞춰 제품 수준으로 강화한다.

### 9.1 Security Baseline

- [ ] [보안 기준선](../security/security_baseline.md)의 모든 MUST 항목을 점검한다.
- [ ] Tauri capability를 window와 command별 최소 권한으로 축소한다.
- [ ] production CSP에 remote origin, `unsafe-eval`과 불필요한 scheme이 없는지 검사한다.
- [ ] shell, broad filesystem과 외부 HTTP capability가 없는지 검사한다.
- [ ] IPC input size, enum, path, identifier와 lifecycle validation을 fuzz한다.
- [ ] URL, Router state, Query cache, log와 crash payload secret scan을 실행한다.
- [ ] credential, result row와 SQL text가 telemetry에 포함되지 않게 한다.
- [ ] telemetry와 crash upload가 기본 비활성화인지 확인한다.
- [ ] dependency vulnerability, source provenance와 license scan을 통과한다.
- [ ] updater key와 signing secret이 개발자 설정 및 artifact에 없는지 확인한다.

### 9.2 Threat Model 검증

- [ ] [위협 모델](../security/threat_model.md)의 T01~T24 완화책을 구현과 대조한다.
- [ ] XSS payload를 cell, column name, notice와 server error에 주입해 escaping을 검증한다.
- [ ] malicious database metadata가 DOM, file export와 log를 오염시키지 않는지 검증한다.
- [ ] TLS downgrade와 invalid certificate 우회가 불가능한지 검증한다.
- [ ] generated SQL injection property test를 장시간 실행한다.
- [ ] stale execution event가 다른 Result Tab에 기록되지 않는지 검증한다.
- [ ] clipboard, export와 history privacy 설정을 수동 검토한다.
- [ ] 발견된 새 신뢰 경계와 잔여 위험을 위협 모델에 반영한다.

### 9.3 성능과 Memory

- [ ] warm start 1.5초와 cold start 2.5초 목표를 측정한다.
- [ ] first interaction 가능 시점 2초 목표를 측정한다.
- [ ] 첫 row chunk UI 반영 latency를 측정한다.
- [ ] 500행 ingest 후 200ms 렌더 예산을 검증한다.
- [ ] 10,000행 Grid 평균 55fps 목표를 검증한다.
- [ ] 100열 column virtualization과 resize latency를 검증한다.
- [ ] 10,000 cells paste parsing과 preview latency를 검증한다.
- [ ] Result Tab당 100MB soft budget을 검증한다.
- [ ] tab/connection close 후 30초 안에 memory가 회복되는지 검증한다.
- [ ] bundle size와 startup regression threshold를 CI에 추가한다.
- [ ] 측정 환경과 결과를 performance 문서에 기록한다.

### 9.4 장애와 복구

- [ ] query streaming 중 network disconnect를 처리한다.
- [ ] suspend/resume과 system sleep 후 connection 상태를 재검증한다.
- [ ] PostgreSQL restart 후 stale pool과 session을 정리한다.
- [ ] app crash 후 SQL draft와 설정 복원을 검증한다.
- [ ] 손상된 settings, workspace와 history file의 안전한 fallback을 구현한다.
- [ ] vault unlock 실패와 key loss 안내를 구현한다.
- [ ] disk full과 permission 오류에서 기존 저장 데이터를 보존한다.
- [ ] commit 결과 불명 상태의 재확인 flow를 E2E로 검증한다.
- [ ] 모든 retry에 횟수 제한과 취소 경로를 제공한다.

### 9.5 전체 Test Matrix

- [ ] PostgreSQL 14~18 type와 query integration matrix를 실행한다.
- [ ] PR에서는 PostgreSQL 16과 18 핵심 matrix를 실행한다.
- [ ] macOS, Windows와 Ubuntu desktop E2E를 실행한다.
- [ ] vault, query, Grid, editing과 persistence regression suite를 완료한다.
- [ ] flaky test를 격리하지 않고 원인과 owner를 기록한다.
- [ ] test fixture에 production/customer data가 없는지 확인한다.
- [ ] code coverage gate와 critical domain branch coverage를 충족한다.

### Phase 9 완료 게이트

- [ ] 보안 기준선과 위협 모델 검증 항목이 모두 통과한다.
- [ ] Tier 1 환경에서 성능 예산을 충족한다.
- [ ] 연결 손실, 앱 crash와 저장 실패에서 사용자 작업이 명세대로 복구된다.
- [ ] PostgreSQL 14~18 compatibility matrix가 통과한다.
- [ ] 알려진 Critical 또는 High 보안 취약점이 없다.

---

## Phase 10 — 플랫폼 패키징과 MVP 릴리스

### 목표

재현 가능하고 서명된 desktop artifact를 생성하고, 설치·업데이트·롤백과 사용자 문서까지 검증해 MVP stable을 배포할 수 있게 한다.

### 10.1 Desktop Packaging

- [ ] macOS arm64와 x86_64 또는 universal bundle을 생성한다.
- [ ] macOS code signing과 notarization을 구성한다.
- [ ] Windows x86_64 signed installer를 생성한다.
- [ ] Ubuntu 기준 AppImage와 선택한 Linux package를 생성한다.
- [ ] WebView2와 WebKitGTK runtime 요구사항을 문서화한다.
- [ ] clean machine install, launch와 uninstall smoke test를 수행한다.
- [ ] artifact에 debug tool, sourcemap과 secret이 없는지 검사한다.

### 10.2 Updater와 공급망

- [ ] Tauri signed updater channel을 nightly, beta와 stable로 분리한다.
- [ ] 서명 없는 update와 변조된 manifest가 거부되는지 test한다.
- [ ] channel과 version downgrade 정책을 구현한다.
- [ ] rollback용 이전 signed artifact 절차를 검증한다.
- [ ] production updater key를 CI protected storage에만 저장한다.
- [ ] build provenance, checksum과 SBOM을 생성한다.
- [ ] root `LICENSE`와 필요한 third-party notice를 artifact에 포함한다.
- [ ] dependency lockfile로 clean reproducible build를 검증한다.

### 10.3 사용자 및 운영 문서

- [ ] 설치, 첫 연결과 TLS certificate 가이드를 작성한다.
- [ ] query shortcut과 새 Result Tab 실행 가이드를 작성한다.
- [ ] 안전한 DB Role과 read-only profile 가이드를 작성한다.
- [ ] Grid copy, edit와 TSV paste 가이드를 작성한다.
- [ ] 백업되지 않는 result와 workspace persistence 범위를 안내한다.
- [ ] mobile Experimental 범위와 VPN/Gateway 요구사항을 안내한다.
- [ ] known limitations와 MVP 제외 기능을 release note에 명시한다.
- [ ] 전용 보안 신고 이메일을 `SECURITY.md`에 등록한다.
- [ ] 개인정보 및 telemetry 기본 비활성 정책을 공개 문서에 포함한다.

### 10.4 Release Candidate

- [ ] version과 migration compatibility를 검증한다.
- [ ] Tier 1 desktop 전체 E2E를 release artifact로 실행한다.
- [ ] security checklist를 release build에 다시 적용한다.
- [ ] accessibility checklist를 실제 artifact에서 완료한다.
- [ ] 성능 benchmark가 기준선 대비 허용 범위 안인지 확인한다.
- [ ] beta tester가 첫 연결부터 editing까지 acceptance flow를 수행한다.
- [ ] blocker, known issue와 rollback 조건을 triage한다.
- [ ] release note, checksum, SBOM과 signature를 검토한다.

### Phase 10 완료 게이트

- [ ] macOS, Windows와 Linux signed release artifact가 생성된다.
- [ ] clean install, update, rollback과 uninstall이 검증된다.
- [ ] 전용 보안 이메일과 취약점 대응 절차가 공개됐다.
- [ ] Apache-2.0 LICENSE, third-party notice와 SBOM이 포함됐다.
- [ ] 제품 명세의 MVP 성공 기준을 모두 충족한다.
- [ ] Critical/High blocker 없이 stable release 승인이 완료됐다.

---

## 5. 모든 Task의 Definition of Done

기능별 체크박스는 다음 조건을 모두 만족할 때만 완료한다.

- [ ] 명세와 acceptance criteria를 만족한다.
- [ ] 정상 경로, 실패 경로와 경계값 test가 있다.
- [ ] Rust와 TypeScript 오류가 사용자에게 안전하고 실행 가능한 형태로 전달된다.
- [ ] credential, SQL text와 result data가 일반 log에 기록되지 않는다.
- [ ] loading, empty, error, disabled와 offline 상태가 처리된다.
- [ ] keyboard와 touch 진입점을 모두 제공한다.
- [ ] 관련 resource가 tab, connection 또는 app 종료 시 정리된다.
- [ ] 성능 예산을 악화시키지 않는다.
- [ ] 관련 문서와 generated IPC binding이 갱신됐다.
- [ ] lint, typecheck, unit, integration 및 해당 E2E test가 통과한다.

## 6. MVP 이후로 미루는 항목

아래 기능은 이 계획의 체크박스에 추가하지 않는다. 구현이 필요해지면 별도 제품 명세와 Phase 계획을 만든다.

- MySQL, MariaDB, SQLite 및 기타 DBMS
- SSH Tunnel
- 여러 statement를 한 번에 실행하는 `Run All`
- ERD와 visual Query Builder
- backup, restore와 전체 database dump
- 사용자·권한 관리 GUI
- cloud sync와 collaboration
- AI SQL 생성
- plugin system
- multiwindow와 tab 분리
- public mobile release와 Gateway server

## 7. 관련 문서

- [상위 구현 전략](../quality/implementation_plan.md)
- [제품 명세](../product/product_spec.md)
- [사용자 흐름](../product/user_flows.md)
- [화면 디자인 명세](../spec/design_spec.md)
- [쿼리 실행 명세](../spec/query_execution_spec.md)
- [PostgreSQL 타입 명세](../spec/postgresql_type_spec.md)
- [Result Grid 명세](../spec/result_grid_spec.md)
- [데이터 편집 명세](../spec/data_editing_spec.md)
- [애플리케이션 아키텍처](../architecture/architecture.md)
- [IPC 계약](../architecture/ipc_contract.md)
- [보안 기준선](../security/security_baseline.md)
- [테스트 전략](../quality/test_strategy.md)
- [성능 예산](../quality/performance_budget.md)
- [플랫폼 지원표](../quality/platform_matrix.md)
