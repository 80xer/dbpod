# DBPod 위협 모델

- 상태: MVP 기준선
- 방법: STRIDE 기반
- 최종 수정일: 2026-07-27

## 1. 범위

포함:

- Tauri desktop/mobile application
- React WebView
- Rust Core와 IPC
- local persistence와 vault
- PostgreSQL 직접 연결
- clipboard, export, log와 updater

제외:

- 향후 Gateway server
- 사용자가 관리하는 PostgreSQL server 자체의 보안
- OS가 완전히 장악된 이후의 모든 공격 방지
- SSH Tunnel

## 2. 보호 자산

### Critical

- PostgreSQL password
- client private key
- vault master secret
- updater signing private key
- PostgreSQL session secret와 cancel key

### High

- Query Result와 edit buffer
- SQL draft와 History
- Connection host, database와 username
- exported data
- production write capability

### Medium

- schema와 table metadata
- application settings
- diagnostic logs
- workspace layout

## 3. 공격자

- 악성 또는 취약한 frontend dependency
- XSS payload가 포함된 database value
- 같은 기기의 다른 application
- local unprivileged user
- network MITM
- 악성 PostgreSQL server
- dependency 또는 update supply-chain attacker
- 사용자의 실수
- DBPod process memory를 읽을 수 있는 privileged attacker

마지막 유형은 완전히 방어할 수 없으며 secret lifetime과 OS protection으로 노출 시간을 줄인다.

## 4. 신뢰 경계

```text
Untrusted DB Value
       │
       ▼
PostgreSQL ──TLS── Rust Core ──Tauri IPC── React WebView
                    │                         │
                    ▼                         ▼
              Secure Storage             Clipboard/Export
                    │
                    ▼
               Local Files
```

경계:

1. Network ↔ Rust PostgreSQL driver
2. Rust Core ↔ React WebView
3. Rust Core ↔ OS secure storage
4. Application ↔ clipboard/file system
5. Build/release system ↔ installed updater

## 5. 핵심 보안 전제

- PostgreSQL Role과 RLS가 실제 DB 인가 경계다.
- Safe Mode는 실수 방지 UX다.
- React WebView는 secret을 보관할 수 있는 신뢰 영역이 아니다.
- 사용자가 입력한 SQL은 실행 의도가 있는 arbitrary code다.
- Query Result는 신뢰할 수 없는 text이며 HTML로 해석하지 않는다.
- OS administrator/root가 process를 완전히 장악하면 memory secret 보호를 보장할 수 없다.

## 6. 위협과 통제

| ID | 위협 | STRIDE | 주요 통제 | 검증 |
| --- | --- | --- | --- | --- |
| T01 | 악성 frontend가 임의 Rust command 호출 | E/T | 최소 capability, local-only webview, command ownership 검증 | capability integration test |
| T02 | DB value를 통한 XSS | T/I/E | text rendering, HTML sanitization, strict CSP, remote content 금지 | XSS fixture E2E |
| T03 | password가 설정·로그에 기록 | I | vault, redacted type, logging denylist | filesystem/log scan |
| T04 | MITM이 DB traffic 탈취 | S/I/T | TLS verify-full, hostname/CA 검증, downgrade 금지 | fake CA test |
| T05 | insecure 모드 오사용 | I/T | explicit warning, PROD 재인증, persistent indicator | UX/security test |
| T06 | generated SQL injection | T/E | parameter binding, catalog identifier quoting | property/integration test |
| T07 | arbitrary SQL이 과도한 권한 사용 | E/T | 최소 권한 Role, read-only profile, Safe Mode | role matrix test |
| T08 | cancellation ID로 다른 query 취소 | T/D | opaque execution ID, ownership registry | cross-tab negative test |
| T09 | 큰 result로 memory exhaustion | D | row/byte limit, chunk, backpressure, memory budget | load test |
| T10 | clipboard에서 민감 데이터 유출 | I | explicit action, optional clear, password copy 금지 | platform test |
| T11 | mobile background snapshot 유출 | I | privacy overlay/native snapshot protection | device test |
| T12 | unsigned update 설치 | T/E | mandatory signature verify, HTTPS endpoint | tampered update test |
| T13 | dependency compromise | T/E | lockfile, audit, SBOM, review, CSP | CI gate |
| T14 | SQL History 유출 | I | encrypted vault, retention, disable/clear | storage inspection |
| T15 | Result Tab close 후 data 잔존 | I | dispose/zero reference, no persistence | lifecycle test |
| T16 | symlink/path traversal export | T/I | native picker, canonical target, no broad file permission | filesystem test |
| T17 | malicious server sends invalid protocol/value | D/E | maintained driver, decode bounds, panic-free error | fuzz/integration test |
| T18 | app log injection | T/R | structured logging, newline/control sanitization | log injection test |
| T19 | local file permission 과다 | I/T | user-only ACL/mode, atomic write | install test |
| T20 | edit race가 다른 변경 덮어쓰기 | T | PK+xmin/original value optimistic lock | concurrency test |
| T21 | Result export formula injection | T | safe CSV mode default | spreadsheet fixture |
| T22 | remote iframe이 IPC 이용 | E | remote source 없음, frame 제한, CSP | config audit |
| T23 | production connection 오인 | T | text environment badge, color secondary, confirm write | accessibility test |
| T24 | crash dump/sourcemap에 secret 포함 | I | production debug off, redaction, sourcemap 비공개 | release artifact scan |

## 7. 상세 분석

### 7.1 WebView compromise

공격:

- compromised npm dependency
- XSS from Result cell, error or schema name
- unsafe HTML renderer

완화:

- database text는 React text node로만 렌더링
- `dangerouslySetInnerHTML` 사용 금지, 예외는 security review
- strict CSP
- remote script/font/CSS 금지
- shell/fs/http plugin 권한 기본 금지
- secret 반환 command 없음
- command별 capability와 object ownership 확인

잔여 위험:

WebView compromise는 사용자 권한으로 query_execute를 호출할 수 있다. 이를 완전히 막을 수 없으므로 최소 권한 PostgreSQL Role과 production confirmation이 필요하다.

### 7.2 Credential theft

공격:

- plain settings
- log/debug output
- clipboard
- process memory
- exported profile

완화:

- OS secure storage + encrypted vault
- secret type의 Debug/Serialize 제한
- one-time password form state 즉시 제거
- profile export MVP 제외
- auto lock
- production diagnostics redaction

### 7.3 Network

- `verify-full` 기본
- SQLx의 `prefer` fallback을 사용하지 않음
- custom CA는 명시적 import
- insecure는 자동 선택되지 않음
- DB port public exposure를 권장하지 않음
- Gateway가 추가되면 별도 threat model 필요

### 7.4 Arbitrary SQL

사용자가 직접 작성한 SQL 실행은 제품 핵심 기능이므로 SQL 자체를 sandbox하지 않는다.

통제:

- SQL 실행 connection의 실제 Role 권한
- read-only Role 권장
- connection environment와 Safe Mode
- timeout/cancel
- Run All 제외
- superuser 경고

parser classification은 stored procedure, volatile function과 dynamic SQL을 완전히 판별할 수 없다.

### 7.5 Generated writes

- frontend가 SQL을 생성하지 않음
- identifier는 trusted catalog metadata
- value는 bind parameter
- changeSet immutable snapshot
- idempotency key
- transaction과 affected row count
- optimistic lock

### 7.6 Result data

- memory only
- tab close에 dispose
- raw HTML 금지
- large value handle
- clipboard explicit
- export safe mode
- crash telemetry 제외

## 8. 개인정보와 telemetry

- telemetry 기본 비활성화
- crash reporting opt-in
- 수집 금지: SQL, row, schema 전문, connection URL, password, certificate, file content
- 수집 가능: app version, OS family, error code, anonymized feature count
- 사용자가 전송 payload를 preview할 수 있어야 함

## 9. 보안 테스트

- capability snapshot test
- CSP regression test
- XSS payload corpus
- secret/log/filesystem scanner
- invalid certificate와 hostname test
- generated SQL property test
- optimistic locking race test
- malformed PostgreSQL value decode test
- clipboard/mobile background device test
- tampered updater test
- dependency audit

## 10. 잔여 위험

- privileged local attacker의 memory dump
- 사용자가 superuser로 실행한 arbitrary SQL
- 사용자가 insecure TLS를 명시적으로 허용
- 사용자가 Result를 clipboard/export로 외부에 전달
- PostgreSQL extension 또는 server vulnerability
- OS WebView zero-day

이 위험은 UI 경고, 최소 권한과 최신 dependency로 줄이지만 제거할 수 없다.

## 11. 검토 시점

다음 변경은 threat model 갱신을 요구한다.

- 새 DBMS
- SSH Tunnel
- Gateway/Cloud sync
- AI/LLM
- plugin system
- remote content
- collaboration
- credential import/export
- telemetry/crash vendor
- multiwindow 또는 remote webview

