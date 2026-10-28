# DBPod Result Grid 명세

- 상태: MVP 기준선
- 최종 수정일: 2026-10-16

## 1. 목적

Result Grid의 렌더링, 가상화, 선택, 키보드, 정렬, 복사·붙여넣기, 편집 상태, 모바일 표현과 성능 경계를 정의한다.

## 2. 구성

```text
TanStack Table
├── column/row model
├── column sizing and pinning
├── sorting state
└── selection-related metadata
        +
TanStack Virtual
├── visible row calculation
└── overscan
        +
DBPod Grid Layer
├── cell focus and rectangular selection
├── keyboard navigation
├── clipboard
├── editors
├── edit buffer
└── accessibility
```

TanStack Table은 DOM을 렌더링하지 않는 headless model로 사용한다. spreadsheet interaction은 DBPod Grid Layer의 책임이다.

## 3. 데이터 소유권

- Result Tab metadata: Workspace state
- column metadata: Result Store
- row chunks: Result Store
- focus, selection, sorting과 column layout: Result Tab grid state
- pending edits: Result Tab edit buffer
- rendered DOM: 현재 viewport와 overscan 범위만

row 전체를 React component state나 TanStack Query persisted cache에 복제하지 않는다.

## 4. Grid 상태

```ts
type ResultGridState = {
  resultTabId: string
  focusedCell?: CellAddress
  selection?: CellRange
  selectedRowIds: Set<string>
  sorting: SortRule[]
  columnOrder: string[]
  columnWidths: Record<string, number>
  pinnedColumns: { left: string[]; right: string[] }
  scroll: { top: number; left: number }
  density: 'compact' | 'comfortable'
}
```

각 Result Tab은 독립적인 Grid 상태를 가진다.

## 5. 행과 column identity

### 5.1 Column

column ID는 이름이 아니라 result column index와 execution ID 조합으로 생성한다. 동일한 column 이름이 여러 번 나타날 수 있기 때문이다.

```text
{executionId}:col:{index}
```

### 5.2 Row

읽기 전용 arbitrary result:

```text
{executionId}:row:{sequence}
```

editable result:

- UI row ID와 DB identity를 분리한다.
- DB identity는 Primary Key tuple과 original row version을 가진다.
- Primary Key 값은 사용자에게 숨겨져도 edit buffer에 안전하게 보관할 수 있다.

## 6. 렌더링과 가상화

### 6.1 기본

- row virtualization은 모든 row result에 사용한다.
- 기본 row height: compact 28px, comfortable 40px
- overscan: desktop 10행, mobile 6행
- header는 sticky다.
- pinned column은 horizontal scroll 중 유지된다.

### 6.2 Column virtualization

- MVP는 row virtualization을 필수로 한다.
- column 100개 이하에서는 전체 column을 렌더링한다.
- 100개 초과 또는 측정 결과 성능 문제가 있으면 column virtualization을 활성화한다.
- pinned column과 keyboard focus가 virtualization으로 사라지지 않아야 한다.

### 6.3 동적 높이

기본 cell은 한 줄 ellipsis를 사용해 고정 row height를 유지한다. multiline, JSON과 큰 값은 Quick View 또는 Row Detail에서 표시한다.

### 6.4 결과 수

- 기본 조회 제한: 500행
- UI 최대 로딩 행: 10,000행
- 10,000행 초과 탐색은 Table Data pagination 또는 export를 사용한다.
- Result Tab memory budget 초과 시 추가 로딩을 막고 이유를 표시한다.

## 7. Column header

Header 기능:

- column 이름
- PostgreSQL type
- nullable 상태를 아는 경우 표시
- Primary Key 및 identity indicator
- sort
- resize
- pin left/right
- hide
- copy column name
- copy qualified name
- filter loaded rows

동일 이름 column은 source alias 또는 ordinal을 함께 표시해 구분한다.

## 8. Focus와 선택

### 8.1 상태 구분

- focused cell: 키보드 명령 대상
- active editor: 현재 편집 input
- cell range: rectangular clipboard 범위
- selected rows: row operation 대상

이 상태를 하나의 selection으로 합치지 않는다.

### 8.2 Pointer

- click: cell focus
- Shift+click: range 확장
- drag: rectangular selection
- row header click: row 선택
- Cmd/Ctrl+row header: row selection toggle
- double click: editable cell 편집 또는 read-only Quick View

### 8.3 Keyboard

| 키 | 동작 |
| --- | --- |
| Arrow | focused cell 이동 |
| Shift+Arrow | selection 확장 |
| Home/End | row의 첫/마지막 column |
| Cmd/Ctrl+Home/End | 로딩 결과의 시작/끝 |
| Page Up/Down | viewport 단위 이동 |
| Enter | 편집 시작 또는 확정 후 아래 이동 |
| F2 | 편집 시작 |
| Escape | edit 취소 또는 selection 축소 |
| Tab/Shift+Tab | 다음/이전 editable cell |
| Space | Row Detail |
| Delete | 선택 row 삭제 draft, 확인 필요 |
| Cmd/Ctrl+C | TSV copy |
| Cmd/Ctrl+V | paste preview 또는 cell paste |
| Cmd/Ctrl+R | 포커스된 결과 다시 조회. Table Data는 현재 정렬로 첫 페이지부터, Query Result는 해당 결과의 실행 SQL을 재실행 |

새로 조회하기 전에 저장되지 않은 편집(확정 전 셀 입력 포함)이 있으면 기존 확인 창으로 변경 폐기 여부를 묻는다. 취소하면 조회하지 않고 편집을 유지한다. 저장 검증·커밋 또는 조회 중에는 중복 조회하지 않는다. 이 단축키는 WebView 자체를 새로고침하지 않는다.

CodeMirror가 focus를 가진 상태에서는 Grid 단축키가 실행되지 않는다.

## 9. 정렬과 filtering

### 9.1 Arbitrary Query Result

- client-side sort/filter는 현재 로딩된 row에만 적용한다.
- `Loaded rows only` indicator를 표시한다.
- SQL을 자동 rewrite해 ORDER BY 또는 WHERE를 삽입하지 않는다.

### 9.2 Table Data Tab

- sort/filter/page는 server-side로 수행한다.
- 적용 전 edit buffer가 있으면 저장, 버리기 또는 취소를 선택한다.
- 새로운 query 결과가 오면 scroll을 시작 위치로 이동한다.

### 9.3 Comparator

PostgreSQL category에 따른 comparator를 사용한다.

- integer/decimal: arbitrary precision
- float: NaN과 infinity 정책
- temporal: 타입 의미에 맞는 비교
- text: 기본 binary/locale 선택
- UUID/network/range/unknown: canonical text
- `NULL`: 기본 last

## 10. 복사

### 10.1 기본 형식

- multi-cell: TSV
- row delimiter: OS 기본 newline
- selected rows: visible column 순서
- hidden column: 기본 제외
- `NULL`: 기본 marker `NULL`
- empty string: empty field

### 10.2 Copy 메뉴

- Cell Value
- Selected Cells as TSV
- Rows as TSV
- Rows as CSV
- Rows as JSON
- Rows as Markdown
- Rows as SQL INSERT
- Column Name
- Qualified Column Name

SQL INSERT copy는 안전한 export일 뿐 자동 실행하지 않는다.

### 10.3 민감 데이터

- copy는 명시적 사용자 동작에서만 수행한다.
- password와 private key UI는 Grid에 나타나지 않는다.
- 클립보드 자동 삭제는 사용자 설정이며 다른 앱의 clipboard를 덮어쓸 수 있음을 안내한다.

## 11. 붙여넣기

### 11.1 Cell paste

- 한 cell 값은 focused editable cell의 draft로 반영한다.
- Rust Core 저장 전 type validation을 다시 수행한다.

### 11.2 Rectangular paste

- TSV shape를 focused cell부터 mapping한다.
- read-only, generated와 identity column을 건너뛸지 오류로 처리할지 Preview에서 선택한다.
- existing rows에 mapping된 값은 UPDATE draft가 된다.
- blank insert rows로 넘어간 값은 INSERT draft가 된다.

현재 MVP의 직접 붙여넣기는 다음 규칙을 적용한다.

- 선택된 셀(범위 선택 시 focus 셀)을 시작점으로 TSV 크기만큼 오른쪽·아래로 매핑한다. 다른 Result Tab에서 복사한 범위도 동일하게 적용한다.
- 기존 행은 UPDATE draft, 사용자가 이미 추가한 새 행은 해당 INSERT draft를 변경한다. 선택된 셀에 붙여넣다가 행이 부족해도 새 행을 자동 생성하지 않는다.
- 행·열 범위 초과, 읽기 전용·binary 셀, 삭제 대기 행 또는 기존 행의 `DEFAULT`가 포함되면 전체 붙여넣기를 거부하고 오류를 표시한다. 일부 셀만 변경하지 않는다.
- 선택이 없는 경우에는 기존 새 행 붙여넣기를 유지한다. 편집 가능한 열 순서로 INSERT draft를 생성한다.
- 셀 편집 중에는 입력 필드의 기본 붙여넣기를 사용한다. 저장 검증 중에는 그리드 붙여넣기를 차단한다.
- 붙여넣기는 편집 버퍼에만 반영하며 DB 반영에는 별도 저장이 필요하다.
- `text[]` 열도 전체 선택 복사·붙여넣기의 대상이다. 배열은 PostgreSQL text 문법으로 매핑하며 원소의 NULL·빈 문자열과 escaping을 보존한다. 다른 배열 타입의 편집 제한은 유지한다.

### 11.3 Import Preview

아래 Preview는 목표 동작이다. 현재 MVP의 직접 붙여넣기는 위의 전체 범위 검증과 오류 표시를 사용하며 별도 Preview UI는 제공하지 않는다.

다음 경우 항상 Preview를 연다.

- 2개 이상 cell
- 새 row 생성
- type conversion warning
- `NULL/DEFAULT` marker 포함
- target column 부족 또는 초과

Preview는 원본 text, parsed value, target type과 error를 보여준다.

### 11.4 제한

- UI paste 최대: 10,000 cells
- 한 번의 MVP insert 최대: 500 rows
- 초과 데이터는 CSV Import 후속 기능 또는 분할 paste를 안내한다.

## 12. 편집

### 12.1 Desktop

- double click 또는 F2로 inline editor 시작
- editor는 type에 맞는 input을 사용
- Enter/Tab은 local draft만 확정
- DB 저장은 Result Toolbar의 Save에서만 수행

### 12.2 Mobile

- cell tap 후 Edit action으로 Bottom Sheet 또는 full-screen editor 표시
- 화면 keyboard에 가려지지 않게 safe area와 viewport를 조정
- `NULL`, `DEFAULT`, clear를 별도 action으로 제공

### 12.3 Large/special value

다음은 inline 대신 Quick Editor를 사용한다.

- multiline text
- JSON/JSONB
- array
- bytea
- range/composite
- 1,000자 이상 text

## 13. 변경 상태

표현:

- modified cell
- inserted row
- deleted row
- conflicted row
- validation error
- saving

색상과 함께 icon, text 또는 accessible description을 사용한다.

Dirty count는 Result Tab과 Work Tab에 함께 표시한다.

## 14. Result Content 상태

- `empty`: 아직 실행하지 않음
- `running`: column 또는 row 대기
- `streaming`: 일부 row 수신
- `success-empty`: 성공했지만 row 없음
- `success-rows`: row 표시
- `command`: 영향받은 행과 command tag
- `error`: PostgreSQL 또는 앱 오류
- `cancelled`: 불완전 결과 가능
- `disconnected`: 세션 종료
- `stale`: 편집 결과가 server와 충돌

각 상태는 keyboard focus와 다음 action을 제공해야 한다.

## 15. 접근성

- Grid 또는 동등한 ARIA semantics를 사용한다.
- cell accessible name에 column과 row context를 포함한다.
- virtualized row의 위치와 전체 로딩 row 수를 알린다.
- sort direction을 header에 노출한다.
- selection과 edit 상태를 screen reader에 알린다.
- focus가 virtualization으로 사라질 때 가장 가까운 유효 cell로 복원한다.
- Result Tab 전환 후 마지막 focused cell을 복원한다.

## 16. 오류와 복구

- 한 cell decode 실패가 전체 결과를 숨기지 않는다.
- chunk sequence 누락 시 결과를 incomplete로 표시하고 재실행을 제공한다.
- memory budget 초과 시 받은 row를 유지하고 추가 수신을 중단한다.
- renderer 오류가 발생해도 Rust session을 자동 commit하거나 변경하지 않는다.

## 17. 수용 조건

- 500행 결과가 첫 chunk부터 표시된다.
- 10,000행에서 DOM row 수가 viewport+overscan 범위로 제한된다.
- 결과 100 column에서 horizontal scroll과 pinned column이 동작한다.
- keyboard만으로 cell 이동, copy, edit와 저장 action 접근이 가능하다.
- integer와 decimal sort가 JavaScript 정밀도를 잃지 않는다.
- 100×10 TSV paste가 Preview와 edit buffer에 정확히 mapping된다.
- Result Tab 전환 후 scroll, sort, selection과 edit draft가 유지된다.
- Result Tab 닫기 후 row buffer가 메모리에서 제거된다.

