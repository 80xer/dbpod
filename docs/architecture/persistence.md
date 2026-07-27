# DBPod 영속성 및 데이터 수명 명세

- 상태: MVP 기준선
- 최종 수정일: 2026-07-27

## 1. 목적

DBPod가 다루는 데이터를 분류하고 저장 위치, 암호화, 보존 기간, migration, 삭제와 crash 복구 정책을 정의한다.

## 2. 데이터 분류

| 등급 | 예 | 정책 |
| --- | --- | --- |
| Secret | DB password, client private key, vault key | OS secure storage와 encrypted vault only |
| Sensitive | SQL draft/history, host/user/database, result | 최소 저장, 암호화 또는 memory only |
| Private setting | 최근 연결, layout, theme | local app storage |
| Public | app version, locale catalog | bundle 가능 |

## 3. 저장소

### 3.1 OS secure storage

저장:

- vault unlock용 random master secret
- 플랫폼이 지원하면 biometric/keychain access control metadata

저장하지 않음:

- Query Result
- SQL History 전문
- layout

플랫폼:

- macOS/iOS Keychain
- Windows Credential Manager 또는 동등한 secure storage
- Android Keystore
- Linux Secret Service, 사용 불가 시 명시적 master password 요구

### 3.2 Encrypted vault

Tauri Stronghold 계열의 검토된 secure storage를 사용한다.

저장:

- DB password
- client certificate private key
- 암호화가 필요한 SQL draft/history payload
- 민감 connection option

각 secret은 opaque `credentialId`로 참조한다.

### 3.3 일반 설정 저장소

Tauri Store 또는 Rust-owned versioned JSON을 사용한다.

저장 가능:

- connection profile의 비민감 필드
- theme, locale와 density
- sidebar width와 split ratio
- selected schemas
- Work Tab metadata
- Result Tab metadata 중 민감하지 않은 최소값
- History enabled와 retention 설정

비밀번호, private key, SQL result와 complete connection URL은 저장하지 않는다.

### 3.4 Memory only

- PostgreSQL session
- backend PID/secret
- Query Result columns와 rows
- active Result edit buffer
- full binary/text value
- decrypted credential
- Tauri Channel

## 4. 데이터별 정책

| 데이터 | 위치 | 암호화 | 기본 보존 |
| --- | --- | --- | --- |
| Connection name/tag/color | 일반 설정 | OS file protection | profile 삭제까지 |
| host/port/database/username | 일반 설정 | OS file protection | profile 삭제까지 |
| password | vault | 필수 | profile 삭제까지 |
| CA public certificate | app data 또는 vault | 민감도에 따라 | profile 삭제까지 |
| client private key | vault | 필수 | profile 삭제까지 |
| SQL draft | vault-backed payload | 필수 | tab 삭제까지 |
| Query History SQL | vault-backed payload | 필수 | 30일/1,000개 |
| Result rows | memory | 해당 없음 | tab 또는 app session |
| edit buffer | memory | 해당 없음 | save/discard/tab close |
| layout | 일반 설정 | 불필요 | reset까지 |
| log | app log dir | redacted | 7일/20MB |

## 5. Connection Profile

```ts
type PersistedConnectionProfile = {
  schemaVersion: number
  id: string
  name: string
  environment: 'local' | 'dev' | 'stage' | 'prod'
  color?: string
  host: string
  port: number
  database: string
  username: string
  credentialId: string
  tlsMode: 'verify-full' | 'verify-ca' | 'insecure'
  caCertificateRef?: string
  clientCertificateRef?: string
  readOnly: boolean
  queryTimeoutMs: number
  maxRows: number
}
```

profile object를 frontend에 줄 때 credential existence boolean은 허용하지만 secret을 반환하지 않는다.

## 6. Workspace 복원

저장:

- open Connection Workspace profile ID
- Work Tab 순서, type와 title
- Query Tab SQL draft reference
- active Work/Result Tab ID
- sidebar와 split layout
- Result Tab label과 executed timestamp의 최소 metadata

저장하지 않음:

- Result columns와 rows
- edit buffer
- execution error detail
- backend/session ID

재시작 시 Result Tab은 `결과는 보안상 복원되지 않았습니다. 다시 실행하세요.` 상태를 표시하거나 빈 Result Panel로 축소할 수 있다.

## 7. Query History

- 기본 활성화
- 보존 30일
- connection profile별 최대 1,000개
- 사용자가 전체 또는 connection별 비활성화 가능
- SQL, 실행 시각, status, duration과 row count 저장
- Result row, bind value와 server notice 전문은 저장하지 않음
- incognito Query Tab을 제공해 draft와 history 저장을 모두 끌 수 있음

History payload는 vault key로 암호화한다.

## 8. 로그

- 기본 level: info
- SQL statement 전문 기록 금지
- connection URL 기록 금지
- credential과 certificate body 기록 금지
- host/database는 diagnostics export 전 사용자 확인
- rotation: 파일당 5MB, 최대 4개
- 보존: 7일 이내
- diagnostics export는 preview와 redaction 확인 제공

## 9. 파일 권한

- app data directory는 현재 사용자만 접근 가능한 위치 사용
- Unix 민감 file은 `0600`, directory는 `0700`
- Windows에서는 사용자 ACL 적용
- 임시 export는 OS temp에 평문으로 만들지 않음
- 사용자 지정 export는 대상과 overwrite를 명시적으로 확인

## 10. Migration

모든 persisted document는 `schemaVersion`을 가진다.

규칙:

- migration은 순차적이고 idempotent
- migration 전 backup copy 생성
- secret migration은 복호화 후 재암호화하되 로그에 값 기록 금지
- migration 실패 시 원본 유지, 앱은 safe recovery mode 진입
- downgrade가 새 schema를 손상하지 않게 read-only 경고

## 11. 삭제

### 11.1 Connection Profile 삭제

사용자 확인 후:

- 일반 profile 제거
- 연결된 vault secrets 제거
- 관련 History와 SQL drafts 제거 선택
- 열린 workspace 종료
- in-memory result 제거

### 11.2 Clear History

- vault record와 index 제거
- UI cache 제거
- 로그에는 삭제한 SQL을 남기지 않고 count만 기록

### 11.3 Reset Application

- 정확한 삭제 범위 preview
- vault, 설정, history와 layout 제거
- export된 사용자 파일은 삭제하지 않음
- 가능하면 OS trash 또는 복구 가능한 backup 옵션 제공

## 12. Lock과 lifecycle

- app background 또는 OS lock 시 vault를 lock할 수 있음
- 기본 자동 lock: 15분 inactivity
- active query가 있어도 UI secret access를 lock할 수 있으며 query 결과 정책은 설정에 따름
- lock 시 Result 화면을 가리고 clipboard 추가 작업을 막음
- unlock 후 기존 session 재사용 여부는 connection health check 후 결정

## 13. Crash 복구

- SQL draft는 debounce 후 atomic write
- 일반 설정은 temporary file + fsync + atomic rename 방식
- Result row와 edit buffer는 crash 후 복원하지 않음
- server transaction은 연결 종료로 rollback
- 다음 시작 시 이전 비정상 종료를 알리고 session health를 새로 확인

## 14. 동기화

MVP는 cloud sync를 지원하지 않는다.

- OS keychain sync가 활성화되어도 DBPod가 profile/settings sync를 가정하지 않는다.
- credential export/import는 MVP 제외다.
- 향후 sync는 별도 암호화 protocol과 threat model이 필요하다.

## 15. 수용 조건

- 일반 설정 파일 검색으로 password와 private key를 찾을 수 없다.
- app restart 후 Query Result row가 복원되지 않는다.
- SQL draft와 History가 encrypted vault 없이는 읽히지 않는다.
- profile 삭제 시 연결된 secret이 제거된다.
- migration 실패가 기존 저장소를 덮어쓰지 않는다.
- log rotation과 retention이 disk를 무제한 사용하지 않는다.
- reset이 사용자 export 파일을 삭제하지 않는다.

