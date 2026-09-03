# MVP 구현 진행 현황

- 최종 수정일: 2026-09-03
- 세부 Task 체크리스트 원본: [plan-mvp.md](plan-mvp.md)
- 기술 결정 기록: [ADR-0006](../architecture/adr/0006-milestone-a-tooling-choices.md)

## 완료된 범위 (macOS 데스크톱 기준)

핵심 플로우가 실제 PostgreSQL 통합 테스트로 검증된 상태:

```
연결 프로필 생성(비밀번호 OS Keychain) → TLS 설정 연결 → 객체 탐색(사이드바)
→ Query Tab SQL 실행(선택/커서 문장, Cmd+Enter / Cmd+Shift+Enter)
→ Channel 스트리밍(50/100행 청크, ack 백프레셔) → 가상화 그리드 탐색
→ 범위 선택·TSV 복사·CSV/JSON 내보내기 → 셀 편집·행 추가/삭제·TSV 붙여넣기
→ SQL Preview → 단일 트랜잭션 저장(xmin optimistic lock, 충돌 시 자동 덮어쓰기 없음)
→ 취소(pg_cancel_backend) → 탭/연결 종료 시 세션·버퍼·핸들 정리
```

| plan-mvp Phase | 상태 | 비고 |
| --- | --- | --- |
| 0 기반 | 대부분 완료 | 스캐폴드·디렉터리 경계·strict TS·clippy -D warnings·lockfile·CI 파일. 모바일 타깃 init/CI 실행은 미착수 |
| 1 Shell | 부분 완료 | Rail·사이드바·Work/Result Tab·단축키. 디자인 토큰·모바일 Drawer·뷰포트 테스트 미착수 |
| 2 보안 연결 | 부분 완료 | keyring 자격 증명(비밀 미영속 테스트 포함)·verify-full 기본·프로필 CRUD. 인증서 import·vault lock·마스터 비밀번호 폴백 미착수 |
| 3 실행 슬라이스 | 완료 게이트 충족 | E2E 대체: testcontainers 통합 11종(순서·terminal 1회·취소·격리·정리) |
| 4 타입·그리드 | 대부분 완료 | 타입 명세 수용 조건 테스트 통과(무손실 정수/50자리 numeric/float 특수값/tz 불변/jsonb raw/bytea 핸들). 다차원 배열은 unknown fallback, 셀 키보드 탐색 미착수 |
| 5 멀티탭 | 대부분 완료 | replace/new-result·pin 보호·Ctrl+Tab/Cmd+1-9·SQL 초안 복원(결과 미복원). 이력은 세션 메모리 한정 |
| 6 탐색기·Table Data | 대부분 완료 | 스키마/객체/테이블 메타데이터·권한 배지·서버측 정렬/페이지네이션·특수문자 식별자 테스트. 인덱스/트리거 표시·Structure Tab 미착수 |
| 7 편집 | 대부분 완료 | 판별(불확실→읽기 전용)·bind param 전용·xmin lock·영향 행 1 검증·원자적 배치·충돌 3옵션·TSV insert. Query Result 판별은 origin metadata+보수적 keyword gate(AST 아님) |
| 8 모바일·접근성 | 미착수 | 실기기/에뮬레이터 필요 |
| 9 하드닝 | 부분 | 보안 원칙은 구현에 내장(비밀·SQL 미로깅, CSP, capability 최소). 체계적 감사·성능 측정 미착수 |
| 10 패키징·릴리스 | 미착수 | 코드 서명 인증서·CI 인프라 필요 |

## 알려진 의도적 컷 (ponytail 마커와 ADR-0006 참조)

- 다차원/특수 배열: unknown text fallback (raw 배열 파서 후속)
- 256KiB 초과 text: 인라인 유지 (binary만 핸들 분리)
- Notice 이벤트: Rust 타입 존재, 미발신 (sqlx notice API 확인 후속)
- 트랜잭션 상태: command tag 상태 머신 (서버 ReadyForQuery 노출 시 교체)
- 쿼리 이력: 세션 메모리 한정 (암호화 영속화 후속)
- 데스크톱 E2E: tauri-driver macOS 미지원으로 통합 테스트가 게이트 역할

## 테스트 현황

- Rust: 단위 3 + 바인딩 1 + keychain 스모크 1 + PostgreSQL 통합 15 (testcontainers, PG17)
- Frontend: vitest 35 (splitter/lexer, resultStore, workspace reducer, TSV 파서, exporter)
- CI: `.github/workflows/ci.yml` (typecheck/vitest/build, fmt/clippy -D/test/바인딩 드리프트, cargo audit)
