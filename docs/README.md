# DBPod 문서 안내

이 디렉터리는 DBPod MVP의 제품, UX, 기술, 보안 및 품질 기준을 담는 구현 계약입니다. 구현 중 판단이 필요한 경우 아래 순서대로 문서를 읽습니다.

1. [제품 명세](product/product_spec.md)에서 범위와 성공 조건을 확인합니다.
2. [화면 디자인 명세](spec/design_spec.md)와 [사용자 흐름](product/user_flows.md)에서 사용자 경험을 확인합니다.
3. 기능별 세부 명세와 아키텍처 문서에서 동작 및 경계를 확인합니다.
4. 보안 기준과 품질 기준을 완료 조건으로 적용합니다.
5. 결정이 바뀌면 코드만 수정하지 않고 관련 명세와 ADR을 함께 갱신합니다.

## 제품

| 문서 | 내용 |
| --- | --- |
| [제품 명세](product/product_spec.md) | 대상 사용자, MVP 범위, 제외 범위, 제품 원칙, 성공 조건 |
| [사용자 흐름](product/user_flows.md) | 연결, 쿼리 실행, 결과 멀티탭, 편집, 붙여넣기, 모바일 흐름 |

## 기능 및 UX 명세

| 문서 | 내용 |
| --- | --- |
| [화면 디자인 명세](spec/design_spec.md) | TablePlus를 참고한 사이드바, Connection Workspace, Query Tab, Result Tab 레이아웃 |
| [디자인 시스템](spec/design_system.md) | Tailwind 토큰, 밀도, 컴포넌트, 반응형 및 접근성 규칙 |
| [쿼리 실행 명세](spec/query_execution_spec.md) | 실행 범위, Result Tab 교체·추가, 세션, 스트리밍, 취소, timeout |
| [PostgreSQL 타입 명세](spec/postgresql_type_spec.md) | 손실 없는 값 표현, 표시, 정렬, 복사, 편집 규칙 |
| [결과 그리드 명세](spec/result_grid_spec.md) | 가상화, 선택, 키보드, 복사, 붙여넣기, 모바일 동작 |
| [데이터 편집 명세](spec/data_editing_spec.md) | 편집 가능성 판정, INSERT·UPDATE·DELETE, 트랜잭션, 충돌 처리 |

## 아키텍처와 결정 기록

| 문서 | 내용 |
| --- | --- |
| [애플리케이션 아키텍처](architecture/architecture.md) | React/Tauri/Rust 계층, 상태 소유권, 연결 및 실행 구조 |
| [IPC 계약](architecture/ipc_contract.md) | Tauri command, Channel event, 입력 제한, 오류 및 취소 계약 |
| [영속성 정책](architecture/persistence.md) | 자격 증명, 설정, 워크스페이스, 이력, 로그의 저장 위치와 수명 |
| [ADR-0001: 쿼리 결과 전송](architecture/adr/0001-query-result-transport.md) | Tauri Channel 기반 스트리밍 |
| [ADR-0002: PostgreSQL 타입 직렬화](architecture/adr/0002-postgresql-type-serialization.md) | 손실 없는 tagged union |
| [ADR-0003: 편집 가능 결과 판정](architecture/adr/0003-editable-result-detection.md) | 보수적인 단일 base table 판정 |
| [ADR-0004: 모바일 DB 전송 경계](architecture/adr/0004-mobile-database-transport.md) | MVP 직접 연결과 후속 Gateway 경계 |
| [ADR-0005: Query Tab 세션](architecture/adr/0005-query-tab-session-affinity.md) | Query Tab별 지연 생성 전용 PostgreSQL 세션 |

## 보안

| 문서 | 내용 |
| --- | --- |
| [위협 모델](security/threat_model.md) | 자산, 신뢰 경계, STRIDE 위협, 완화책, 잔여 위험 |
| [보안 기준선](security/security_baseline.md) | IPC, CSP, 자격 증명, TLS, SQL, 로그, 배포 필수 체크리스트 |
| [취약점 신고 정책](../SECURITY.md) | 비공개 신고 원칙과 대응 범위 |

## 품질과 전달

| 문서 | 내용 |
| --- | --- |
| [MVP 상세 구현 계획](plan/plan-mvp.md) | Phase별 세부 Task, 의존 순서와 체크 가능한 완료 게이트 |
| [구현 전략 요약](quality/implementation_plan.md) | 수직 슬라이스, 단계별 산출물과 완료 조건 요약 |
| [테스트 전략](quality/test_strategy.md) | TDD, 단위·통합·E2E·보안 테스트와 CI 게이트 |
| [플랫폼 지원표](quality/platform_matrix.md) | 데스크톱, 모바일, PostgreSQL 버전별 지원 수준 |
| [성능 예산](quality/performance_budget.md) | 시작, 실행, Grid, 메모리, 번들 성능 기준 |
| [접근성 체크리스트](quality/accessibility_checklist.md) | 키보드, 스크린 리더, 터치, 색상 및 동작 검증 |
| [릴리스 전략](quality/release_strategy.md) | 채널, 서명, 업데이트, 롤백 및 출시 게이트 |
| [기여 가이드](../CONTRIBUTING.md) | 개발 흐름, 코드 규칙, 테스트 및 PR 기준 |

## 결정 우선순위

문서가 충돌하면 임의로 한쪽을 선택하지 않습니다. 다음 우선순위를 적용하고 같은 변경에서 충돌 문서도 함께 정리합니다.

1. 보안 기준선과 위협 모델의 필수 통제
2. 제품 명세의 MVP 범위와 제외 범위
3. 기능별 세부 명세
4. 화면 디자인 명세와 사용자 흐름
5. 아키텍처 및 현재 승인된 ADR
6. README의 개요

ADR은 특정 기술 결정의 이유를 보존합니다. 새로운 결정으로 대체할 때 기존 ADR을 삭제하지 않고 `Superseded` 상태와 대체 ADR 링크를 남깁니다.

## 현재 미결정 항목

DBPod의 배포 라이선스는 Apache License 2.0으로 확정했습니다. 아래 항목만 공개 배포 전 제품 소유자가 확정해야 합니다.

- 비공개 보안 신고에 사용할 실제 이메일 주소

그 밖의 MVP 기술·제품 결정은 이 문서 세트에서 기본값을 확정했습니다. 구현 과정에서 새로운 미결정 사항이 생기면 해당 명세에 `Open Decision`으로 기록하고, 사용자 데이터·보안·호환성에 영향을 주는 경우 구현 전에 제품 소유자의 결정을 받습니다.
