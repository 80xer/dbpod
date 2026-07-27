# ADR-0002: PostgreSQL 값은 lossless tagged union으로 직렬화한다

- 상태: Accepted
- 날짜: 2026-07-27

## Context

PostgreSQL `int8`, `numeric`, timestamp, JSON, array, `bytea`와 extension type을 JavaScript primitive로 직접 변환하면 정밀도, timezone, `NULL` 또는 binary 의미를 잃을 수 있다.

## Decision

- IPC 값은 `kind` discriminant를 가진 `DbValue` tagged union을 사용한다.
- 모든 integer, decimal과 float는 canonical string을 사용한다.
- `NULL`은 별도 variant다.
- timestamp without timezone과 timestamptz를 다른 variant metadata로 구분한다.
- JSON은 raw text로 보관한다.
- bytea는 base64와 large value handle을 사용한다.
- array dimension과 lower bound를 보존한다.
- unknown type은 OID, name과 text fallback을 제공하고 기본 읽기 전용으로 한다.

## Alternatives

### 모두 문자열

손실은 적지만 type-aware sort, editor와 copy 정책을 만들기 어려워 거부한다.

### JavaScript primitive

편하지만 큰 숫자와 시간대에서 데이터가 손실되어 거부한다.

### 각 PostgreSQL 타입별 개별 IPC type

정확하지만 extension과 domain이 늘어날수록 contract가 폭발하므로 category 기반 union을 선택한다.

## Consequences

- frontend formatter와 comparator가 필요하다.
- payload가 primitive보다 커진다.
- display와 edit round-trip을 명확히 test할 수 있다.
- 향후 다른 DBMS도 동일 domain category에 mapping할 수 있다.

## References

- [`../../spec/postgresql_type_spec.md`](../../spec/postgresql_type_spec.md)

