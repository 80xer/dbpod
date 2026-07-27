# ADR-0004: 모바일 확장을 위해 DatabaseTransport 경계를 둔다

- 상태: Accepted
- 날짜: 2026-07-27

## Context

Tauri 2와 Rust PostgreSQL driver로 모바일 직접 연결이 가능하더라도 일반 사용자의 DB port를 공용 인터넷에 노출하는 것은 적절하지 않다. 사내 VPN 직접 연결과 향후 Gateway 연결을 모두 고려해야 한다.

## Decision

- application service는 `DatabaseTransport` port에 의존한다.
- MVP 구현은 `DirectPostgresTransport` 하나다.
- 데스크톱은 직접 연결한다.
- 모바일 직접 연결은 VPN 또는 private network를 전제로 한다.
- 공개 모바일 제품은 별도 `GatewayTransport`와 server threat model을 만든 뒤 지원한다.
- 현재 존재하지 않는 Gateway abstraction을 UI 곳곳에 노출하지 않는다.

## Alternatives

### 모든 플랫폼 직접 연결

단순하지만 public mobile deployment의 네트워크와 credential 위험이 커서 제품 기본값으로 거부한다.

### 처음부터 Gateway 필수

보안 통제가 쉽지만 서버 제품, 인증과 운영 범위가 크게 늘어 MVP에서 거부한다.

### Desktop과 Mobile codebase 분리

중복과 동작 차이가 커져 거부한다.

## Consequences

- direct transport domain contract를 신중히 정의해야 한다.
- Gateway는 나중에 동일 UX contract로 추가할 수 있다.
- mobile MVP의 실제 DB 연결 범위는 VPN 환경으로 제한된다.

