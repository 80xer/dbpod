# DBPod 핵심 사용자 흐름

- 상태: MVP 기준선
- 최종 수정일: 2026-07-27

## 1. 목적

이 문서는 주요 사용자가 DBPod에서 목표를 달성하는 단계와 실패·취소·보안 상태를 정의한다. 화면 배치는 [`../spec/design_spec.md`](../spec/design_spec.md), 구체적인 실행 규칙은 [`../spec/query_execution_spec.md`](../spec/query_execution_spec.md)를 따른다.

## 2. 첫 연결 만들기

### 사전 조건

- 사용자가 PostgreSQL host, port, database와 username을 알고 있다.
- 비밀번호 또는 클라이언트 인증 수단을 가지고 있다.

### 기본 흐름

1. 사용자가 `새 연결`을 선택한다.
2. 연결 이름과 환경 `LOCAL/DEV/STAGE/PROD`를 지정한다.
3. host, port, database와 username을 입력한다.
4. TLS는 기본 `verify-full`로 표시된다.
5. 필요한 경우 사용자 CA 또는 mTLS 인증서를 선택한다.
6. 비밀번호를 입력하고 `연결 테스트`를 실행한다.
7. 성공 시 서버 버전, TLS와 지연 시간을 표시한다.
8. 사용자가 저장하면 비밀값은 vault에, 비민감 프로필은 설정 저장소에 기록된다.
9. Connection Workspace가 열리고 객체 metadata를 lazy load한다.

### 실패 흐름

- DNS 실패: host를 확인할 수 없음을 표시한다.
- timeout: 네트워크, VPN과 방화벽 점검 안내를 제공한다.
- 인증 실패: 비밀번호를 로그에 남기지 않고 재입력을 요청한다.
- 인증서 실패: `insecure`로 자동 하향하지 않고 인증서와 hostname 정보를 표시한다.
- database 없음: 접근 가능한 database를 임의로 탐색하지 않고 입력 수정을 요청한다.

## 3. 기존 연결 열기

1. 사용자가 저장된 연결을 선택한다.
2. vault가 잠겨 있으면 OS 인증 또는 vault unlock을 요청한다.
3. Rust Core가 TLS 설정을 검증하고 metadata 세션을 연다.
4. 연결 상태가 `Connected`로 바뀐다.
5. 이전 세션의 Query Tab과 SQL 초안을 복원한다.
6. 이전 결과 행은 복원하지 않고 각 Result Panel에 재실행 안내를 표시한다.

## 4. 객체 탐색

1. 사용자가 Connection Workspace를 활성화한다.
2. Object Sidebar에서 schema와 object section을 선택한다.
3. 검색어를 입력하면 로딩된 metadata 전체에 fuzzy search를 수행한다.
4. table을 한 번 클릭하면 Preview Tab으로 Data View를 연다.
5. 다른 object를 한 번 클릭하면 수정되지 않은 Preview Tab을 교체한다.
6. 더블클릭하거나 편집을 시작하면 탭을 Pin한다.

### 권한 오류

- 목록 조회 권한이 없는 section은 빈 목록으로 위장하지 않고 제한된 권한임을 표시한다.
- 접근 불가 object는 다른 object 탐색을 막지 않는다.

## 5. 기본 쿼리 실행

1. 사용자가 Query Tab을 생성한다.
2. SQL을 입력한다.
3. 선택 영역이 있으면 해당 SQL을, 없으면 커서가 있는 구문을 실행한다.
4. Query Tab 전용 세션이 없으면 lazy하게 연다.
5. 빈 Result Panel이면 `Result 1`을 생성한다.
6. 기존 활성 Result Tab이 보호되지 않았으면 그 탭을 running 상태로 교체한다.
7. Rust Core가 column metadata와 row chunk를 전송한다.
8. Grid가 첫 chunk부터 렌더링한다.
9. 완료 후 행 수, 소요 시간과 상태를 표시한다.

### 오류

- syntax error: 위치와 서버 메시지를 Error Result로 표시한다.
- permission denied: object와 필요한 권한을 표시한다.
- timeout: `Timed Out` 상태와 재실행 명령을 제공한다.
- disconnect: 받은 행은 보존하고 결과를 불완전 상태로 표시한다.

## 6. 새 Result Tab에서 실행

1. 사용자가 SQL을 수정하거나 선택 영역을 바꾼다.
2. `Cmd/Ctrl + Shift + Enter` 또는 `Run in New Result Tab`을 실행한다.
3. 활성 Result Tab 오른쪽에 새 탭을 생성한다.
4. 기존 Result Tab과 Grid 상태를 그대로 유지한다.
5. 새 탭을 활성화하고 running 상태를 표시한다.
6. 결과 완료 후 두 Result Tab 사이를 전환해 비교한다.

기본 실행 대상이 Pin, dirty, exporting 또는 running 상태라면 기본 실행도 새 Result Tab을 자동 생성하고 이유를 알린다.

## 7. 실행 취소

1. 실행 중인 Query Tab에서 사용자가 Stop 또는 취소 단축키를 누른다.
2. UI는 즉시 `Cancelling` 상태를 표시한다.
3. Rust Core는 `executionId`에 매핑된 PostgreSQL backend 취소를 요청한다.
4. 서버 응답이 오면 Result Tab을 `Cancelled`로 표시한다.
5. 이미 도착한 row는 참고용으로 유지하지만 완전한 결과가 아님을 표시한다.
6. 취소가 일정 시간 안에 확인되지 않으면 해당 세션을 강제 종료하고 재연결 안내를 제공한다.

## 8. 결과 편집 및 저장

1. 사용자가 editable Result Tab의 셀을 편집한다.
2. 변경된 셀과 상위 Result/Work Tab에 dirty 상태를 표시한다.
3. 사용자가 `Preview SQL`을 선택해 parameter가 제거된 안전한 SQL template과 변경 요약을 본다.
4. `Save`를 선택한다.
5. Rust Core가 transaction을 시작한다.
6. 각 행을 parameter binding과 optimistic locking 조건으로 변경한다.
7. 모든 행이 예상한 수만큼 변경되면 commit한다.
8. 새 row version과 server 반환값으로 Grid를 갱신한다.

### 충돌

1. 한 행의 영향받은 행 수가 예상과 다르면 transaction을 rollback한다.
2. 충돌한 행과 원래 값, 로컬 값과 최신 서버 값을 표시한다.
3. 사용자는 `서버 값 사용`, `내 변경 다시 적용`, `취소` 중 하나를 선택한다.
4. 자동 덮어쓰기는 하지 않는다.

## 9. TSV로 레코드 추가

1. 사용자가 Table Data Tab 또는 insert 가능한 Result Tab에서 시작 셀을 선택한다.
2. 스프레드시트의 TSV 데이터를 붙여넣는다.
3. DBPod가 행·열 mapping과 타입 변환 결과를 Preview에 표시한다.
4. 사용자가 `NULL`, 빈 문자열과 `DEFAULT` 해석을 확인한다.
5. validation error가 있는 셀을 수정하거나 해당 행을 제거한다.
6. 사용자가 Insert를 확인한다.
7. 모든 행을 하나의 transaction으로 parameterized INSERT한다.
8. 성공하면 server가 반환한 key와 default 값을 표시한다.
9. 한 행이라도 실패하면 전체 rollback하고 실패 위치를 표시한다.

## 10. 연결 전환

1. 사용자가 Connection Rail 또는 모바일 Connection Switcher를 연다.
2. 다른 Connection Workspace를 선택한다.
3. 기존 workspace의 Query Tab, Result Tab, Grid와 Sidebar 상태를 유지한다.
4. 새 workspace의 마지막 active tab과 상태를 복원한다.
5. 환경 badge와 connection status가 즉시 갱신된다.

키보드 포커스는 새 workspace의 마지막 focused region 또는 active Work Tab으로 이동한다.

## 11. Query Tab 닫기

### 안전하게 닫을 수 있는 경우

- 실행 중인 쿼리가 없다.
- 열린 transaction이 없다.
- dirty Result Tab이 없다.
- SQL 초안이 복원 저장 대상이다.

이 경우 세션을 정상 종료하고 in-memory 결과를 제거한다.

### 확인이 필요한 경우

- running: 취소 후 닫기 또는 유지
- transaction: rollback 후 닫기 또는 유지
- dirty result: 저장, 버리기 또는 취소
- export: 완료 대기, 취소 후 닫기 또는 유지

## 12. 모바일 흐름

### 객체 탐색

1. 상단 메뉴로 Object Drawer를 연다.
2. schema, section과 search를 사용한다.
3. object를 열면 Drawer가 닫히고 Work Tab으로 이동한다.

### 쿼리와 결과 전환

1. `Editor`에서 SQL을 작성한다.
2. 하단 `Run` 또는 `Run in New Result`를 누른다.
3. 성공 시 `Results`로 자동 전환한다.
4. Result Tab을 가로 스크롤해 선택한다.
5. Editor로 돌아가도 Result 상태가 유지된다.

### 셀 편집

1. 셀을 누르면 Bottom Sheet 또는 전체 화면 editor를 연다.
2. type에 맞는 입력과 `NULL/DEFAULT` control을 제공한다.
3. 확인하면 로컬 edit buffer만 변경한다.
4. Result Toolbar의 Save에서 transaction을 수행한다.

