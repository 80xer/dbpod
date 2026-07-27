# DBPod 데이터 편집 및 레코드 생성 명세

- 상태: MVP 기준선
- 최종 수정일: 2026-07-27

## 1. 목적

Table Data와 Query Result에서 편집 가능 여부를 판별하고, 셀 수정, 행 추가·삭제, TSV paste, SQL preview, parameter binding, transaction과 optimistic locking을 수행하는 규칙을 정의한다.

## 2. 안전 원칙

- 편집 가능하다고 증명할 수 없으면 읽기 전용이다.
- 사용자 값은 SQL 문자열에 삽입하지 않는다.
- schema, table과 column identifier는 catalog metadata에서 얻고 안전하게 quote한다.
- 한 Result Tab의 저장은 하나의 transaction으로 처리한다.
- 예상과 다른 영향받은 행 수는 conflict로 처리한다.
- 자동으로 최신 server 값을 덮어쓰지 않는다.
- Preview SQL에 실제 민감 bind value를 기본 표시하지 않는다.

## 3. 편집 가능한 결과

### 3.1 Table Data Tab

다음 조건을 모두 만족하면 편집 가능하다.

- 대상이 PostgreSQL base table
- Primary Key 존재
- 사용자가 SELECT와 필요한 쓰기 권한 보유
- table metadata를 최신 상태로 읽음
- read-only connection이 아님

Table Data query에는 보이지 않는 identity metadata를 포함한다.

- Primary Key tuple
- `xmin` row version
- relation OID

### 3.2 Query Result

MVP에서는 다음 조건을 모두 만족해야 한다.

- 정확히 하나의 `SELECT` statement
- `FROM`에 base table 하나
- JOIN 없음
- CTE 없음
- subquery source 없음
- `DISTINCT` 없음
- aggregate, `GROUP BY`, `HAVING` 없음
- window function 없음
- `UNION`, `INTERSECT`, `EXCEPT` 없음
- 반환 column이 base table의 direct column reference 또는 alias
- Primary Key의 모든 column이 결과에 포함
- 중복 source column 없음
- source relation과 column mapping이 metadata 또는 안전한 SQL 분석으로 확정
- read-only connection이 아님

`ORDER BY`, `LIMIT`, `OFFSET`은 편집 가능 여부를 해치지 않는다.

### 3.3 읽기 전용

다음 결과는 MVP에서 읽기 전용이다.

- View와 Materialized View
- JOIN
- 집계와 window
- computed expression
- 함수 결과
- Primary Key 없는 table
- key column이 결과에 없는 query
- source mapping이 모호한 duplicate column
- system catalog
- unknown/custom type 중 안전한 encoder가 없는 column

읽기 전용 이유를 Result Toolbar에서 확인할 수 있어야 한다.

## 4. Query Result 판별

판별 순서:

1. PostgreSQL result column origin metadata 확인
2. PostgreSQL-compatible SQL AST로 statement shape 확인
3. relation OID를 catalog에서 base table로 확인
4. attribute number와 selected column mapping 확인
5. Primary Key 구성과 결과 포함 여부 확인
6. column별 update/insert capability 계산

어느 단계든 불확실하면 전체 결과 또는 해당 column을 읽기 전용으로 만든다.

SQL 분석은 편집 UX를 위한 것이며 악성 SQL 보안 경계가 아니다.

## 5. 변경 모델

```ts
type RowIdentity = {
  relationOid: number
  primaryKey: Array<{
    attributeNumber: number
    columnName: string
    value: DbValue
  }>
  xmin?: string
}

type RowChange =
  | {
      operation: 'update'
      rowId: string
      identity: RowIdentity
      originalValues: Record<string, DbValue>
      changes: Record<string, DbValue>
    }
  | {
      operation: 'insert'
      rowId: string
      values: Record<string, InsertCellDraft>
    }
  | {
      operation: 'delete'
      rowId: string
      identity: RowIdentity
      originalValues: Record<string, DbValue>
    }
```

변경은 Result Tab별 edit buffer에 저장한다.

## 6. UPDATE

### 6.1 생성

개념적 SQL:

```sql
UPDATE "schema"."table"
SET "changed_column" = $1
WHERE "pk_column" = $2
  AND xmin::text = $3
RETURNING "pk_column", "changed_column", xmin::text;
```

- identifier는 catalog 원본을 quote한다.
- changed column만 SET에 포함한다.
- 값은 모두 bind parameter다.
- Table Data Tab은 Primary Key와 `xmin`을 조건으로 사용한다.

### 6.2 Query Result fallback lock

Query Result에 실행 시점 `xmin`이 없으면:

- Primary Key 전체를 사용한다.
- 결과에 직접 mapping된 original column 전체를 `IS NOT DISTINCT FROM` 조건으로 추가한다.
- 표시된 값 중 하나라도 server에서 바뀌었으면 conflict로 처리한다.
- 선택되지 않은 다른 column 변경은 충돌로 보지 않는다.

이 방식은 Table Data의 `xmin`보다 약하므로 UI에 `displayed columns conflict check`로 표시한다.

### 6.3 영향받은 행

- 정확히 1행: 성공
- 0행: 삭제되었거나 version conflict
- 2행 이상: identity 오류, 전체 rollback 및 internal safety error

## 7. INSERT

### 7.1 column 모드

```ts
type InsertCellDraft =
  | { mode: 'value'; value: DbValue }
  | { mode: 'null' }
  | { mode: 'default' }
```

### 7.2 규칙

- `default` column은 INSERT column 목록에서 제외한다.
- `null`은 typed NULL bind value다.
- 빈 문자열은 text value다.
- generated column은 입력할 수 없다.
- identity `GENERATED ALWAYS`는 MVP에서 명시적 override를 지원하지 않는다.
- column default와 constraint의 최종 검증은 PostgreSQL이 수행한다.
- INSERT는 `RETURNING`으로 generated key, default와 version을 받는다.

### 7.3 Batch

- 한 paste transaction 최대 500행
- insert shape가 같은 행끼리 prepared statement를 재사용할 수 있다.
- shape가 다른 `DEFAULT` 조합은 statement group을 나눈다.
- 한 행이라도 실패하면 전체 rollback한다.

## 8. DELETE

- 선택 행을 즉시 DB에서 삭제하지 않고 delete draft로 표시한다.
- Save에서 Primary Key와 optimistic lock 조건으로 DELETE한다.
- Preview에 삭제 행 수와 대상 table을 명확히 표시한다.
- 10행 이상 삭제는 추가 확인을 요구한다.
- 영향받은 행 수가 예상과 다르면 전체 rollback한다.

## 9. TSV paste

### 9.1 parsing

- delimiter: tab
- newline: CRLF 또는 LF
- quoted field와 embedded newline 지원
- trailing empty field 보존
- clipboard text 최대 10MiB
- 최대 10,000 cells
- insert 확정 최대 500 rows

### 9.2 marker

기본:

- `NULL`: SQL NULL
- 빈 field: empty string 또는 column-specific empty value
- `DEFAULT`: insert default

marker 해석은 Preview에서 변경할 수 있다. literal `NULL` 문자열을 넣으려면 value 모드로 전환한다.

### 9.3 mapping

- focused cell이 있으면 그 column부터 mapping
- 새 row 영역이면 INSERT draft
- existing row이면 UPDATE draft
- read-only column은 Preview error
- column 수가 초과하면 행별 error
- 부족한 insert column은 `DEFAULT`

### 9.4 validation

React:

- 빠른 syntax와 shape 확인
- 즉시 cell error 표시

Rust Core:

- PostgreSQL type parsing
- length와 range
- identifier와 permission
- 최종 bind encoding

PostgreSQL:

- constraint
- trigger
- RLS
- domain
- generated value

## 10. Save transaction

### 10.1 순서

1. edit buffer snapshot 생성
2. 사용자 권한과 connection 상태 확인
3. transaction 시작
4. DELETE
5. UPDATE
6. INSERT
7. 반환 row와 영향받은 행 수 검증
8. 모든 성공 시 commit
9. Result Store를 server 반환값으로 갱신
10. edit buffer 제거

DELETE/UPDATE/INSERT 순서는 FK와 unique constraint 때문에 실패할 수 있다. 사용자가 순서를 조정해야 하는 복잡한 변경은 MVP에서 Preview 후 실패 메시지로 안내하며 자동 dependency planning은 하지 않는다.

### 10.2 실패

- 어떤 statement든 실패하면 rollback
- 성공한 일부 row를 UI에서 committed로 표시하지 않음
- 실패 row, column, constraint와 SQLSTATE 표시
- bind value 전문은 일반 로그에 남기지 않음
- edit buffer는 유지

## 11. Preview SQL

Preview는 다음을 보여준다.

- 대상 connection, environment와 database
- transaction 단위
- operation별 row 수
- identifier가 포함된 SQL template
- parameter 번호와 type
- 민감 값이 제거된 변경 요약

기본적으로 실제 value는 표시하지 않는다. 사용자가 명시적으로 `Show values`를 선택하면 현재 화면에만 표시하고 로그나 clipboard에 자동 저장하지 않는다.

## 12. Conflict 해결

### 12.1 표시 정보

- original displayed value
- local draft
- latest server value
- conflict column
- row identity

### 12.2 선택

- `Use Server`: local draft 제거
- `Reapply Mine`: latest version 기준으로 새 draft 생성
- `Keep Editing`: 저장하지 않고 돌아감
- `Discard All`: Result Tab의 모든 변경 제거

`Reapply Mine`도 즉시 commit하지 않고 다시 Save해야 한다.

## 13. RLS, trigger와 permission

- Row Level Security와 trigger를 우회하지 않는다.
- server가 반환한 결과를 권위 있는 값으로 사용한다.
- `RETURNING` 결과가 없으면 RLS 또는 trigger를 포함한 원인을 표시한다.
- table owner/superuser로 연결했다고 편집 제한을 완화하지 않는다.
- permission metadata는 hint이며 최종 권한은 server 오류로 확인한다.

## 14. Connection loss

- dirty edit buffer는 memory에 유지한다.
- reconnect 후 기존 row version이 유효하다고 가정하지 않는다.
- 저장 전 affected row 조건으로 conflict를 확인한다.
- Table Data Tab은 최신 값 refresh 옵션을 제공한다.
- app restart에는 edit buffer를 복원하지 않는다.

## 15. 수용 조건

- PK와 xmin이 같은 Table Data row만 UPDATE된다.
- 다른 client가 row를 변경하면 0 affected conflict로 처리된다.
- Query Result에서 표시된 original value 변경을 감지한다.
- duplicate 또는 ambiguous source column은 편집할 수 없다.
- 모든 generated write SQL이 bind parameter를 사용한다.
- 100행 paste가 하나의 transaction으로 commit된다.
- 한 insert constraint 오류가 전체 batch를 rollback한다.
- `NULL`, empty string과 `DEFAULT`가 구분된다.
- generated/identity always column을 실수로 변경하지 않는다.
- 실패 후 edit buffer가 유지되고 성공 후 server 반환값으로 갱신된다.

