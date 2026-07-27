# ADR-0001: Query Result는 Tauri Channel로 전송한다

- 상태: Accepted
- 날짜: 2026-07-27

## Context

PostgreSQL 결과는 수백 행부터 수만 행까지 커질 수 있다. 전체 결과를 하나의 Tauri command JSON 응답으로 반환하면 첫 표시가 늦고 Rust와 WebView 양쪽에서 큰 배열 복사와 직렬화 비용이 발생한다.

Tauri global event는 type safety, 대상 격리와 ordered high-throughput 처리에 적합하지 않다. Tauri 공식 문서는 streaming에 Channel 사용을 권장한다.

## Decision

- command는 실행 접수와 `executionId` 반환에 사용한다.
- column, row chunk, notice와 terminal은 execution 전용 Tauri Channel로 보낸다.
- 첫 chunk 50행, 이후 기본 100행을 사용한다.
- chunk는 sequence를 가지며 UI ack로 bounded backpressure를 적용한다.
- 결과 행은 frontend 외부 Result Store에 추가한다.
- Result Tab dispose 시 channel, Rust value handle과 row buffer를 제거한다.

## Alternatives

### 하나의 command 응답

단순하지만 큰 결과의 latency와 memory peak가 커서 거부한다.

### Global event

구현은 쉽지만 event collision, cleanup, ordering과 type contract가 약해 거부한다.

### Local HTTP/WebSocket server

강한 streaming 제어가 가능하지만 local port, authentication과 공격 표면이 추가되어 MVP에서는 거부한다.

## Consequences

- stream protocol과 terminal exactly-once test가 필요하다.
- frontend Result Store가 chunk를 처리해야 한다.
- cancellation과 tab disposal lifecycle이 명시적으로 연결된다.
- 대용량 결과의 첫 화면 latency와 peak memory를 줄일 수 있다.

## References

- [Tauri: Calling Rust from the Frontend](https://v2.tauri.app/develop/calling-rust/)

