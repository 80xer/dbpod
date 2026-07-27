# DBPod 보안 기준선

- 상태: Mandatory
- 최종 수정일: 2026-07-27

## 1. 적용

이 문서의 `MUST` 항목은 MVP release gate다. 예외는 threat model, 기간, owner와 제거 계획을 기록한 보안 예외 문서가 있어야 한다.

## 2. Tauri

### MUST

- bundled local frontend만 IPC에 접근
- remote capability 미사용
- command별 최소 permission
- invoking window/webview와 object ownership 검증
- strict CSP 설정
- remote script, stylesheet, font와 iframe 금지
- `unsafe-eval` 금지
- 불필요한 shell, fs, http와 opener permission 금지
- production devtools 비활성화

### CSP 기준

개념적 최소값:

```text
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' asset: blob: data:;
connect-src ipc: http://ipc.localhost;
object-src 'none';
frame-src 'none';
base-uri 'none';
form-action 'none';
```

Tauri가 요구하는 platform source는 build 결과에 맞게 추가하되 wildcard와 remote origin을 허용하지 않는다. Tailwind inline style 처리 때문에 필요한 `style-src` 예외는 script 실행 권한으로 확장하지 않는다.

## 3. Secret

### MUST

- password/private key는 OS secure storage + encrypted vault
- 일반 JSON, localStorage, Router, Query cache 금지
- frontend로 stored secret 반환 금지
- log와 error에서 redaction
- secret-containing type의 Debug 출력 금지
- vault key를 app bundle 또는 source에 포함 금지
- auto lock과 explicit lock 제공
- profile 삭제 시 연결 secret 제거

### SHOULD

- decrypted secret lifetime 최소화
- Rust secret buffer zeroize
- biometric/hardware-backed storage 사용
- clipboard paste 직후 password form state 제거

## 4. PostgreSQL TLS

### MUST

- 기본 `verify-full`
- hostname 검증
- trusted CA 검증
- TLS failure 시 plaintext fallback 금지
- custom CA explicit import
- insecure 상태 persistent indicator
- PROD insecure 연결에 vault 재인증

### MUST NOT

- driver 기본 `prefer`에 의존
- 인증서 오류를 무시하고 자동 재시도
- certificate/private key body log

## 5. Authentication과 authorization

- DBPod는 PostgreSQL 권한을 확대하지 않는다.
- 최소 권한 Role을 문서화한다.
- superuser 연결은 경고한다.
- read-only profile은 session setting과 read-only Role을 함께 권장한다.
- RLS와 trigger를 우회하지 않는다.
- Safe Mode를 security boundary라고 표현하지 않는다.

## 6. SQL

### 사용자 SQL

- arbitrary SQL은 사용자의 명시적 실행에서만 전송
- 자동 background 재실행 금지
- SQL History 암호화
- timeout과 cancel
- Run All MVP 제외

### 생성 SQL

- 모든 value bind parameter
- identifier는 catalog metadata에서 quote
- immutable preview changeSet
- transaction
- affected row count
- optimistic lock
- duplicate commit idempotency

## 7. Result와 clipboard

- Result row disk persistence 금지
- tab close/app lock에서 dispose
- DB text를 HTML로 해석 금지
- explicit copy만 허용
- password/private key copy 금지
- safe CSV export 기본
- mobile background snapshot 보호
- large value size limit

## 8. Logging

### 허용

- request/execution opaque ID
- command name
- duration
- row/chunk count
- byte count
- error code와 safe SQLSTATE
- app/OS version

### 금지

- SQL 전문
- DbValue/row
- password/token/key
- connection URL
- certificate body
- clipboard
- export content

log는 structured format, control character sanitization, rotation과 7일 retention을 적용한다.

## 9. Persistence

- 민감 file user-only permission
- atomic write
- schema version
- migration backup
- query result memory only
- SQL draft/history encrypted
- reset/delete scope 명확화
- OS temp에 민감 평문 파일 금지

## 10. Dependency와 build

### MUST

- `pnpm-lock.yaml`, `Cargo.lock` commit
- exact release build dependency 사용
- npm/Rust vulnerability scan
- license inventory
- reproducible CI instructions
- release artifact malware/secret scan
- platform code signing
- updater signature verification
- signing private key CI secret storage
- production sourcemap 비공개

### CI gate

- lint/type check/test
- `cargo audit`
- `cargo deny`
- npm audit 또는 동등 scanner
- secret scan
- SBOM 생성
- high/critical vulnerability 처리 또는 문서화된 예외

## 11. Error handling

- Rust panic detail을 UI에 노출하지 않음
- PostgreSQL safe detail/hint만 전달
- secret과 full row redaction
- retryable 명시
- auth/TLS/permission을 다른 오류와 구분
- production error dialog에서 diagnostics preview 제공

## 12. Mobile

- Keychain/Keystore
- background snapshot blur
- app lock/biometric 옵션
- password input에 secure text flag
- clipboard 접근 explicit
- direct DB는 VPN/private network 권장
- public mobile release 전 Gateway threat model

## 13. Release checklist

- [ ] remote capability 없음
- [ ] CSP snapshot 승인
- [ ] production devtools 꺼짐
- [ ] insecure TLS 기본값 아님
- [ ] secret/log scan 통과
- [ ] generated SQL parameter binding test 통과
- [ ] XSS corpus test 통과
- [ ] updater tamper test 통과
- [ ] dependency audit 통과
- [ ] code signing 확인
- [ ] mobile privacy screen 확인
- [ ] SECURITY.md 연락 경로 유효

## 14. 참고

- [Tauri Security](https://v2.tauri.app/security/)
- [Tauri CSP](https://v2.tauri.app/security/csp/)
- [Tauri Capabilities](https://v2.tauri.app/security/capabilities/)
- [OWASP Desktop App Security Top 10](https://owasp.org/www-project-desktop-app-security-top-10/)
- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)

