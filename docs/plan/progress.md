# MVP 구현 진행 현황

- 최종 검증: 2026-09-08, macOS / PostgreSQL 17
- [수정 내역과 검증 근거](../quality/hardening-review-2026-09-08.md)
- [전체 제품 계획](plan-mvp.md): 아래 구현 범위를 넘어서는 항목은 후속 작업이다.

## 구현·검증한 흐름

프로필 생성·수정 → 저장된 자격 증명 또는 일회용 비밀번호 연결 → 객체 탐색 → SQL 실행·Table Data 조회 → 스트리밍·결과 비교 → 셀 편집·삽입·삭제 → SQL 미리보기 → 원자적 저장·충돌 처리 → 결과·세션·연결 정리.

| 영역 | 현재 동작 |
| --- | --- |
| 연결 | TLS verify-full 기본, OS Keychain 비밀번호, 비밀번호 미저장 연결, 프로필 편집. 열린 프로필은 종료 후 수정 |
| 객체 탐색 | 파티션은 부모 테이블 아래에 접어서 표시. 다단계·다른 스키마 파티션과 부모 경로를 보존하는 검색 지원 |
| 워크스페이스 | 연결별 외부 상태 저장소, 화면 전환 중 완료 처리, 중복 실행 차단, pin·dirty·저장 중 결과 보호 |
| 실행 | Query Tab별 전용 PostgreSQL actor, 단일 문장 prepare, ACK 백프레셔, DB 완료까지 drain, 취소·timeout·오류 후 복구 |
| 타입 | 정수·numeric 문자열, temporal 전체 범위·infinity·24:00, empty/unbounded range 구분, binary handle, 미지원 타입 명시 |
| 메모리 | 24GB 데스크톱 기준 결과 512MiB / 연결 1GiB / 앱 2GiB. 보존량은 원본 × 4 + 컬럼당 256바이트로 추정하고 IPC는 실제 직렬화 크기로 계산. 1MiB 초과 인라인 행은 잘라 표시하지 않고 결과를 truncate |
| 그리드 | 가상화, 범위 선택, 방향키·Home/End·Enter/F2·Escape, TSV 복사·붙여넣기, CSV/JSON 내보내기 |
| Table Data | 탭별 페이지·정렬 복원, 정렬에 PK tie-breaker, 검증된 xmin으로 편집 |
| 편집 | 보수적 단일 테이블 판정, UPDATE·DELETE 충돌 검사, preview 만료·소유권·용량 제한, 트랜잭션 저장, 저장 중 편집 고정 |
| 충돌 | 서버 값·새 xmin 갱신, 삭제된 행 제거와 나머지 편집 좌표 동시 재배치 |
| 저장 | AES-256-GCM 스냅샷, OS Keychain 키, 평문 스냅샷 마이그레이션, 손상 파일 덮어쓰기 차단, 저장 오류 표시 |
| 종료 | 초안 저장 후 연결 정리. 실행·미저장 편집·열린 트랜잭션 확인. native close 동작의 IPC 순서는 UI 테스트로 검증 |

## 이번 검증

- Frontend: Vitest 111개, 13개 파일. 실제 Router·저장소·채널을 연결한 UI 회귀 테스트 포함.
- Rust: 37개. 단위 8 + 바인딩 1 + Keychain 1 + PostgreSQL 기존 15 + 실행·편집·자원 회귀 11 + 타입 경계 1.
- TypeScript, rustfmt, Clippy `-D warnings`, IPC 바인딩 재생성 검사.
- macOS release `.app` 번들 생성. 배포 서명·공증은 수행하지 않았다.
- `pnpm audit --prod --audit-level high`: 알려진 취약점 없음.
- `cargo audit`: 취약점 오류 없이 종료. 간접 의존성 경고 17개(유지보수 중단, glib unsound 권고 포함)는 아래 릴리스 조건으로 남는다.
- Browser 연결과 Computer Use native pipe가 제공되지 않아 이번 실행에서 실제 화면·실기기 조작 검증은 하지 못했다. DOM 기반 UI 테스트와 Rust 통합 테스트는 각각 통과했다.

파티션 목록 변경 추가 검증: 탐색기 UI 테스트 3개, PostgreSQL 메타데이터 테스트 2개 통과. 1,001개 직접 파티션·다단계·다른 스키마·일반 상속 구분과 검색·권한·접기를 확인했다. TypeScript·Clippy 검사와 macOS 앱 재빌드도 통과했다.

## 남은 제품·릴리스 범위

- Windows/Linux 및 모바일 빌드·실기기 검증, 모바일 background privacy, 반응형·스크린리더 수용 검사.
- 사용자 CA import, 앱 잠금, Keychain 부재 시 암호화 vault 폴백.
- 열 리사이즈·고정·클라이언트 정렬, Structure Tab, 인덱스·트리거 UI, 디자인 토큰·테마·국제화.
- 미지원 배열·확장 타입의 완전한 디코딩, 큰 text 지연 조회, PostgreSQL Notice 전달.
- SQLx가 서버 transaction status를 공개하지 않아 상태 표시는 명령 상태 머신이다. 성공·실패 판정 자체는 DB 스트림 완료를 기다린다.
- 같은 데이터 디렉터리를 여러 앱 프로세스가 공유하는 실행은 지원하지 않는다. 현재 저장 직렬화는 프로세스 안에서 보장한다.
- 코드 서명·공증·서명된 업데이트·플랫폼 릴리스 CI, 실제 보안 신고 연락처.
- Linux GTK3/glib 및 Tauri 간접 의존성 권고 검토와 업스트림 대응. 호환되지 않는 major crate를 강제로 덮어쓰지 않는다.
- 메모리 예산은 보수적 데이터 보존량 기준이며 실제 프로세스 RSS·프레임 성능 측정은 별도다.
