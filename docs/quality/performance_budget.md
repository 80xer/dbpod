# DBPod 성능 예산

- 상태: MVP 기준선
- 최종 수정일: 2026-07-27

## 1. 목적

대용량 결과와 여러 PostgreSQL session을 다루면서 UI 응답성과 memory 사용을 통제하기 위한 측정 가능한 예산을 정의한다.

## 2. Reference 환경

### Desktop low baseline

- 4 core modern CPU
- 8GB RAM
- SSD
- 1920×1080

### Mobile baseline

- 최근 4년 이내 mid-range device
- 6GB RAM
- Android 12 또는 iOS 16

DB server latency test는 localhost와 50ms simulated network를 분리한다.

## 3. Startup

| 지표 | 목표 | 최대 허용 |
| --- | --- | --- |
| warm launch to shell | 1.5s | 2.0s |
| cold launch to shell | 2.5s | 3.5s |
| first input responsive | 2.0s | 3.0s |
| vault unlock UI | 300ms | 700ms, OS auth 제외 |

startup에서 DB 연결을 자동 block하지 않는다. workspace shell을 먼저 표시하고 연결은 async로 복원한다.

## 4. UI latency

| 동작 | 목표 |
| --- | --- |
| key/button feedback | 50ms 이내 |
| Work/Result Tab switch | 100ms 이내 |
| Sidebar fuzzy search update | 100ms 이내 |
| Grid cell focus move | 16ms frame 내 |
| theme switch | 200ms 이내 |
| Drawer/Sheet start | 100ms 이내 |

animation은 60fps 목표이며 reduced motion에서는 불필요한 transition을 제거한다.

## 5. Query result

- 기본 maxRows: 500
- 첫 chunk: 최대 50행
- 후속 chunk: 기본 100행
- chunk soft byte limit: 1MiB
- UI max loaded rows: 10,000
- single Result Tab memory soft limit: 100MB
- connection workspace result memory soft limit: 400MB desktop, 150MB mobile
- app result memory hard guard: 800MB desktop, 250MB mobile

hard guard에 도달하면 새 row 수신을 중단하고 받은 결과를 유지한다.

## 6. First result latency

DB server 실행 시간을 제외한 client overhead:

| 단계 | 목표 |
| --- | --- |
| command 접수 | 30ms |
| columns decode/전송 | 50ms |
| 첫 chunk ingest | 100ms |
| 첫 row paint | chunk 수신 후 100ms |
| 500행 전체 ingest | 마지막 수신 후 200ms |

## 7. Grid

### Row

- rendered row: viewport + overscan, 일반적으로 100 미만
- 10,000 loaded rows scroll 평균 55fps 이상
- 최악 frame 50ms 초과 비율 1% 미만

### Column

- 100 column 전체 render 지원
- 300 column에서 column virtualization 또는 degraded mode
- column resize 중 45fps 이상

### Cell

- 기본 text 한 줄
- 256KiB 이상 large text는 handle 사용
- binary inline 256KiB 이하
- Quick View가 닫히면 decoded preview 해제

## 8. Session과 connection

- desktop Query session 기본 한도 8
- mobile 기본 한도 3
- control pool desktop max 4, mobile max 2
- connection health check가 UI thread를 block하지 않음
- workspace close 후 2초 안에 idle session 정상 종료 목표

## 9. Clipboard와 edit

| 작업 | 목표 |
| --- | --- |
| 1,000 cells copy | 100ms |
| 10,000 cells paste parse | 300ms |
| 100 rows Preview | 200ms, DB validation 제외 |
| 100 rows commit UI progress start | 100ms |
| Result Tab dispose | 100ms foreground 작업 |

500 rows commit의 server 시간은 예산에서 분리하지만 progress UI는 responsive해야 한다.

## 10. Bundle

초기 목표:

- frontend compressed bundle: 2.5MB 이하
- initial JS compressed: 1.0MB 이하
- CodeMirror와 heavy editor extension lazy load 검토
- source map release package 미포함
- unused Tauri plugin 미포함

native bundle은 platform runtime 차이가 있어 회귀율로 관리한다.

## 11. Memory recovery

측정:

1. 10,000행 Result Tab 5개 생성
2. 모두 닫기
3. GC와 async cleanup 대기
4. retained memory 확인

목표:

- Result Store row reference 100% 제거
- large value handle 100% 제거
- process memory가 peak 대비 70% 이상 회수 가능
- listener/channel leak 없음

allocator와 WebView 특성상 RSS가 즉시 감소하지 않을 수 있으므로 retained object를 주 지표로 사용한다.

## 12. Regression gate

- PR micro benchmark: baseline 대비 15% 이상 악화 경고
- nightly app benchmark: 10% 이상 악화 실패 후보
- release: hard budget 초과 차단
- benchmark 변경 시 이유와 새 baseline review

## 13. Profiling

- React Profiler
- browser performance trace
- Rust tracing span
- heap snapshot
- platform startup trace

profiling build도 SQL, row와 secret을 trace에 포함하지 않는다.

## 14. 수용 조건

- reference desktop에서 startup 최대 허용 충족
- 10,000행 Grid scroll 예산 충족
- 500행 stream이 첫 chunk부터 렌더링
- Result Tab close 후 retained row 없음
- 10,000 cells paste가 UI를 1초 이상 block하지 않음
- hard memory guard가 app crash 대신 수신 중단으로 동작

