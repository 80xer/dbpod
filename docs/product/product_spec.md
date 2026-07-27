# DBPod 제품 명세

- 상태: MVP 기준선
- 버전: 0.1
- 최종 수정일: 2026-07-27

## 1. 제품 개요

DBPod는 PostgreSQL에 직접 연결해 SQL을 작성·실행하고, 결과를 탐색·비교·복사·추가·편집할 수 있는 크로스 플랫폼 데이터베이스 클라이언트다.

데스크톱 애플리케이션을 먼저 출시하지만 UI 구조, 상태 모델, Rust Core와 데이터 전송 계약은 Android와 iOS를 동시에 고려한다.

## 2. 목표 사용자

### 2.1 애플리케이션 개발자

- 개발·스테이징 DB에서 SQL을 빠르게 실행한다.
- 여러 조건의 결과를 Result Tab으로 나란히 비교한다.
- 테이블 데이터를 직접 수정하거나 테스트 데이터를 붙여넣는다.

### 2.2 데이터 엔지니어와 분석가

- 여러 스키마와 테이블을 빠르게 탐색한다.
- 긴 조회 결과를 복사하거나 내보낸다.
- 쿼리 초안과 결과 스냅샷을 작업 단위로 관리한다.

### 2.3 DBA와 운영 담당자

- 연결 환경과 읽기 전용 상태를 즉시 식별한다.
- 파괴적 쿼리 실행 전에 경고를 받는다.
- 생성된 변경 SQL을 확인한 뒤 트랜잭션으로 저장한다.

## 3. 제품 원칙

- 빠른 탐색: 연결, 객체, Query Tab과 Result Tab 사이를 키보드로 이동할 수 있어야 한다.
- 결과 보존: 실행 결과와 미저장 편집을 명시적 동작 없이 잃지 않아야 한다.
- 보수적 편집: 원본 행을 안전하게 식별할 수 있을 때만 결과 편집을 허용한다.
- 최소 권한: React WebView가 직접 DB 자격 증명이나 PostgreSQL 연결을 소유하지 않는다.
- 정확성 우선: 숫자 정밀도, 시간대, `NULL`과 binary 값을 표시 편의 때문에 손실하지 않는다.
- 로컬 우선: 자격 증명과 조회 결과를 외부 서비스로 전송하지 않는다.
- 같은 개념, 다른 표현: 데스크톱과 모바일의 정보 구조는 같고 입력 방식과 배치만 다르다.

## 4. MVP 목표

### 4.1 포함 범위

- PostgreSQL 연결 프로필 생성, 수정, 삭제 및 연결 테스트
- TLS `verify-full`, 사용자 CA 인증서와 읽기 전용 프로필
- 여러 Connection Workspace 동시 사용
- PostgreSQL 스키마와 객체 탐색
- Query Tab 생성, 닫기, 이름 변경 및 세션 복원
- 현재 선택 SQL 또는 커서가 있는 현재 구문 실행
- 현재 Result Tab 교체 실행
- 새 Result Tab 실행
- 쿼리 취소, timeout, 결과 행 제한과 chunk 전송
- 결과 테이블 정렬, 열 크기, 고정, 선택 및 가상 스크롤
- TSV 복사와 붙여넣기
- 단일 테이블 결과의 보수적인 셀 편집
- 신규 레코드 일괄 INSERT
- 변경 SQL 미리보기, 저장 및 취소
- optimistic locking과 충돌 안내
- Light, Dark, System 테마
- 한국어와 영어 UI 문자열 구조
- macOS, Windows, Linux 데스크톱 빌드
- 모바일 반응형 UI 및 Android/iOS 빌드 검증

### 4.2 MVP 제외 범위

- MySQL, MariaDB, SQLite 및 기타 DBMS
- SSH Tunnel
- 여러 SQL 문장을 한 번에 실행하는 `Run All`
- 저장 프로시저 전용 실행 UI
- ERD와 시각적 Query Builder
- 백업, 복원 및 전체 DB dump
- 사용자·권한 관리 GUI
- 클라우드 동기화와 협업
- AI SQL 생성
- 플러그인 시스템
- 결과 데이터의 세션 간 복원
- 멀티윈도우와 탭 분리
- 모바일 App Store 정식 배포

제외 항목은 구조적으로 확장 가능해야 하지만 MVP 코드에 빈 추상화를 미리 추가하지 않는다.

## 5. 플랫폼 전략

### 5.1 개발 및 검증 순서

1. macOS에서 첫 vertical slice 개발
2. Windows CI와 실제 패키징 검증
3. Linux CI와 주요 배포판 검증
4. Android/iOS 빌드와 핵심 화면 검증
5. 모바일 직접 연결 또는 Gateway 제품화

### 5.2 모바일 연결 전략

MVP 구조는 `DatabaseTransport` 경계를 둔다.

- 데스크톱: PostgreSQL 직접 연결
- 사내·개발 모바일: VPN 내부에서 직접 연결 가능
- 일반 모바일 배포: HTTPS/WebSocket Gateway를 권장

Gateway 자체는 MVP 범위에 포함하지 않는다.

## 6. 핵심 사용자 가치

### 6.1 빠른 결과 비교

한 Query Tab에서 SQL을 수정하면서 `Cmd/Ctrl + Shift + Enter`로 이전 결과를 유지한 새 Result Tab을 만든다.

### 6.2 안전한 직접 편집

원본 테이블과 식별 키가 확실한 결과만 편집할 수 있다. 저장 전 생성 SQL을 확인하고 충돌이 없을 때만 트랜잭션을 commit한다.

### 6.3 스프레드시트 호환

선택한 결과를 TSV로 복사하고, 스프레드시트에서 복사한 여러 행을 미리 본 뒤 하나의 트랜잭션으로 삽입한다.

## 7. 기능 정책

### 7.1 쿼리 실행

- 선택 영역이 있으면 선택된 SQL을 실행한다.
- 선택 영역이 없으면 커서가 있는 현재 구문을 실행한다.
- 빈 입력은 Rust Core를 호출하지 않는다.
- Query Tab 하나에는 동시에 하나의 실행만 허용한다.
- 서로 다른 Query Tab은 동시에 실행할 수 있다.
- 기본 행 제한은 500행이다.
- 기본 timeout은 60초이며 연결별로 변경할 수 있다.

### 7.2 PostgreSQL 세션

- Query Tab은 첫 실행 시 전용 PostgreSQL 세션을 lazy하게 획득한다.
- 같은 Query Tab의 실행은 같은 세션을 사용한다.
- `BEGIN`, `COMMIT`, `ROLLBACK`, 임시 테이블과 `SET` 상태가 Query Tab 안에서 유지된다.
- 열린 transaction이 있는 Query Tab을 닫거나 연결을 끊을 때 rollback 여부를 확인한다.
- Query Tab을 닫으면 세션을 정상 종료한다.

### 7.3 결과 보존

- 기본 실행은 활성화된 보호되지 않은 Result Tab을 교체한다.
- 새 결과 실행은 기존 결과를 변경하지 않고 오른쪽에 새 Result Tab을 만든다.
- Pin, 미저장 편집, 실행 또는 내보내기 중인 결과는 교체하지 않는다.
- Result Tab을 닫으면 해당 행 데이터와 편집 버퍼를 메모리에서 제거한다.
- 앱 재실행 시 SQL 초안은 복원하지만 결과 행은 복원하지 않는다.

### 7.4 편집

- Table Data Tab은 Primary Key가 있는 base table에서 편집 가능하다.
- Query Tab 결과는 단일 base table과 식별 키가 확실한 경우에만 편집 가능하다.
- View, JOIN, 집계, `DISTINCT`, set operation 결과는 MVP에서 읽기 전용이다.
- 모든 생성 쓰기 SQL은 bind parameter를 사용한다.
- 한 Result Tab의 변경은 하나의 transaction으로 저장한다.

## 8. 비기능 요구사항

### 8.1 보안

- 자격 증명은 OS 보안 저장소와 암호화 vault에만 저장한다.
- React, URL, Router state, 일반 로그에 비밀값을 저장하지 않는다.
- PostgreSQL TLS 기본값은 `verify-full`이다.
- Tauri remote capability를 사용하지 않는다.
- 프로덕션 업데이트는 서명을 검증한다.

### 8.2 성능

- warm start 목표는 1.5초 이하이다.
- 첫 인터랙션 가능 시점 목표는 2초 이하이다.
- 기본 500행 결과는 마지막 row 수신 후 200ms 안에 표시를 시작한다.
- 10,000개 로딩 행에서 스크롤 중 DOM row 수를 제한한다.
- 단일 Result Tab 메모리 예산은 기본 100MB이다.

### 8.3 접근성

- 키보드만으로 연결 전환, 탭 전환, 실행과 결과 탐색이 가능해야 한다.
- 상태를 색상만으로 표현하지 않는다.
- 포커스가 항상 식별 가능해야 한다.
- 모바일 주요 터치 대상은 comfortable density를 사용한다.

### 8.4 개인정보

- telemetry와 crash report는 기본 비활성화한다.
- 활성화하더라도 SQL, 결과, connection string과 자격 증명을 수집하지 않는다.
- 민감 결과를 디스크나 원격 서버에 자동 저장하지 않는다.

## 9. 성공 기준

MVP는 다음 조건을 모두 충족할 때 완료로 간주한다.

- 세 개 이상의 Connection Workspace를 독립적으로 전환할 수 있다.
- 한 Query Tab에서 기본 실행과 새 Result Tab 실행이 명세대로 동작한다.
- 실행 취소가 다른 Query Tab의 실행에 영향을 주지 않는다.
- 주요 PostgreSQL 타입을 정밀도 손실 없이 표시·복사할 수 있다.
- 10,000행 로딩 상태에서 결과 Grid가 실사용 가능한 속도로 스크롤된다.
- 단일 테이블 결과를 편집하고 충돌을 감지할 수 있다.
- 100행 TSV 붙여넣기가 원자적으로 성공하거나 전체 rollback된다.
- 비밀값이 로그, URL, Query cache와 일반 설정 파일에 나타나지 않는다.
- macOS, Windows, Linux 패키지가 CI에서 생성된다.
- Android/iOS에서 핵심 UI가 빌드되고 responsive smoke test를 통과한다.

## 10. 오픈소스 정책

- DBPod 소스 코드와 문서는 Apache License 2.0으로 배포한다.
- Apache-2.0의 저작권 및 특허 라이선스 조건을 따른다.
- 외부 기여는 별도 합의가 없는 한 Apache-2.0 조건으로 제출된 것으로 처리한다.
- 의존성은 Apache-2.0 배포와 호환되는 라이선스만 허용한다.
- 배포 artifact에는 `LICENSE`, 필요한 third-party notice와 SBOM을 포함한다.
