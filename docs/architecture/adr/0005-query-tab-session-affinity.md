# ADR-0005: Query Tab은 PostgreSQL session affinity를 가진다

- 상태: Accepted
- 날짜: 2026-07-27

## Context

실행마다 임의 pool connection을 사용하면 `BEGIN`, temporary table, `SET ROLE`, advisory lock과 session setting이 다음 실행에서 사라지거나 다른 Query Tab에 섞일 수 있다. DB client 사용자는 한 editor tab의 session 연속성을 기대한다.

## Decision

- Query Tab은 첫 실행 시 전용 PostgreSQL connection을 lazy하게 연다.
- 같은 Query Tab의 모든 Result execution은 같은 session을 사용한다.
- 한 Query Tab에는 동시에 하나의 execution만 허용한다.
- metadata, table browsing, cancellation과 edit transaction은 별도 control pool을 사용한다.
- desktop 기본 session 한도는 connection당 8, mobile은 3이다.
- Query Tab 닫기 전에 open transaction을 확인한다.

## Alternatives

### 모든 실행에서 shared pool 사용

connection 수는 적지만 session semantics가 깨져 거부한다.

### Connection Workspace 전체가 session 하나 공유

Query Tab 사이 transaction과 temporary state가 섞이고 병렬 실행이 불가능해 거부한다.

### 모든 Query Tab 생성 시 즉시 connection

빈 tab도 server connection을 소비하므로 lazy open을 선택한다.

## Consequences

- 많은 실행된 Query Tab은 여러 server connection을 사용한다.
- session limit UX가 필요하다.
- tab 단위 transaction state와 cancellation이 정확해진다.
- 서로 다른 Query Tab 실행을 병렬화할 수 있다.

