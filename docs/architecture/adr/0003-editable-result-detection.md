# ADR-0003: Query Result 편집은 증명 가능한 단일 base table로 제한한다

- 상태: Accepted
- 날짜: 2026-07-27

## Context

JOIN, aggregate, view와 expression 결과를 수정할 때 어떤 원본 row와 column을 변경해야 하는지 모호하다. 잘못된 추론은 의도하지 않은 데이터를 수정할 수 있다.

## Decision

- Table Data Tab은 Primary Key와 hidden `xmin`을 포함해 편집한다.
- Query Result는 SQL shape, relation/column origin과 Primary Key 포함을 모두 확인한다.
- 단일 base table의 direct column 결과만 편집한다.
- JOIN, CTE, view, aggregate, window, DISTINCT와 set operation은 읽기 전용이다.
- source가 모호하면 편집을 허용하지 않는다.
- generated SQL은 identifier quoting과 bind parameter를 사용한다.
- optimistic locking failure는 전체 edit transaction을 rollback한다.

## Alternatives

### 모든 SELECT 결과에서 사용자가 target table 선택

강력하지만 mapping 오류와 데이터 손상 위험이 커 MVP에서 거부한다.

### Query Result는 모두 읽기 전용

안전하지만 필수 제품 요구사항을 만족하지 못해 거부한다.

### SQL rewrite로 PK/xmin 자동 삽입

복잡한 PostgreSQL syntax와 semantics를 변경할 위험이 있어 MVP에서 거부한다.

## Consequences

- 일부 단순해 보이는 결과도 읽기 전용일 수 있다.
- UI가 읽기 전용 이유를 설명해야 한다.
- driver origin metadata 기술 spike가 필요하다.
- 안전한 범위에서 필수 inline edit 기능을 제공한다.

## References

- [`../../spec/data_editing_spec.md`](../../spec/data_editing_spec.md)

