# DBPod Security Policy

## 현재 상태

DBPod는 pre-release 개발 단계이며 아직 지원되는 public release가 없다.

## 취약점 보고

취약점은 공개 issue, discussion 또는 로그 전문으로 보고하지 않는다.

DBPod는 저장소와 분리된 전용 보안 이메일을 비공개 신고 채널로 사용한다. 공개 issue, discussion, 일반 기능 문의 채널이나 개인 메시지로 취약점을 보내지 않는다.

실제 이메일 주소는 저장소 소유자가 제공한 뒤 아래 항목에 등록한다. 주소가 등록되기 전에는 public stable release를 만들지 않는다.

- Security email: `[제품 소유자 입력 필요]`
- PGP key: optional

보고 내용:

- 영향받는 version/commit
- 재현 조건
- 예상 영향
- 최소한의 proof of concept
- 제안 완화책

실제 DB password, production connection string 또는 고객 데이터를 첨부하지 않는다.

## 응답 목표

public release 이후 목표:

- 접수 확인: 3 영업일
- 초기 severity 평가: 7일
- Critical 완화/수정 목표: 14일
- High 수정 목표: 30일
- Medium/Low: 정기 release 계획

복잡도와 coordinated disclosure 상황에 따라 달라질 수 있다.

## 범위

포함:

- credential/vault 노출
- Tauri IPC 권한 상승
- CSP/XSS
- generated SQL injection
- TLS 검증 우회
- updater signature 우회
- Query Result/History 무단 저장 또는 전송
- edit conflict로 인한 의도하지 않은 데이터 변경

일반적으로 제외:

- 사용자가 superuser로 의도적으로 실행한 SQL
- 사용자가 명시적으로 선택한 insecure TLS
- root/admin이 장악한 기기에서의 memory dump
- upstream PostgreSQL 자체 취약점
- 지원 종료 OS
- rate limit 없는 local UI를 사용자가 직접 반복 조작한 경우

제외 여부와 관계없이 안전에 영향을 주는 보고는 검토한다.

## 안전한 연구

- 본인이 소유하거나 명시적으로 허가받은 DB만 사용한다.
- production data를 추출하지 않는다.
- 서비스 거부를 일으키지 않는다.
- signing/update infrastructure를 공격하지 않는다.
- 취약점을 공개하기 전에 조정 시간을 제공한다.

## 보안 문서

- [Threat Model](docs/security/threat_model.md)
- [Security Baseline](docs/security/security_baseline.md)
- [IPC Contract](docs/architecture/ipc_contract.md)
