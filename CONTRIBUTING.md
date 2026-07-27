# Contributing to DBPod

DBPod는 아직 MVP 구현 전 단계다. 구현은 README와 `docs/` 명세를 기준으로 진행한다.

## 개발 원칙

- 기능 또는 bugfix는 test에서 시작한다.
- PostgreSQL 데이터 정확성과 보안을 편의보다 우선한다.
- 범위를 벗어난 추상화를 미리 추가하지 않는다.
- Rust Core와 React WebView 신뢰 경계를 유지한다.
- 사용자 SQL과 Query Result를 일반 로그에 기록하지 않는다.
- 기존 명세와 다른 동작은 코드보다 문서를 먼저 변경한다.

## 필수 도구

- Node.js LTS
- pnpm
- Rust stable
- Tauri 2 플랫폼별 prerequisite
- PostgreSQL 16 또는 18
- Docker 또는 호환 container runtime

프로젝트 scaffold 후 표준 script는 다음 이름을 제공해야 한다.

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm tauri dev
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

Rust:

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-features
```

## 변경 절차

1. 관련 제품/기술 명세를 확인한다.
2. acceptance criteria를 test case로 변환한다.
3. 실패하는 test를 작성한다.
4. 최소 구현으로 통과시킨다.
5. refactor 후 lint/type/security test를 실행한다.
6. 동작 또는 결정이 바뀌면 문서와 ADR을 갱신한다.

## 코드 구조

Frontend:

- `app`: bootstrap/router/provider
- `features`: 사용자 기능
- `entities`: 공통 domain type
- `shared`: IPC/UI/기반 library
- `generated`: Rust에서 생성한 type, 수동 수정 금지

Rust:

- `commands`: Tauri adapter
- `application`: use case
- `domain`: framework-independent model/rule
- `infrastructure`: SQLx/persistence/platform
- `security`: vault/redaction/capability

dependency 규칙은 [`docs/architecture/architecture.md`](docs/architecture/architecture.md)를 따른다.

## TypeScript

- strict TypeScript
- `any`는 boundary adapter 외 금지
- discriminated union 선호
- user-facing async state를 명시적으로 모델링
- component에서 직접 Tauri `invoke` 금지, typed IPC adapter 사용
- Result row를 일반 React state에 복제하지 않음

## Rust

- `unsafe`는 기본 금지
- panic/unwrap을 user input path에서 사용하지 않음
- error는 `AppError`로 redaction 후 boundary를 통과
- secret type은 Debug 출력 금지
- generated write SQL은 value binding 필수
- async task와 Channel에 cancellation/cleanup 경로 필수

## Test

- unit test는 deterministic해야 한다.
- PostgreSQL semantics는 실제 disposable DB로 test한다.
- sleep 기반 wait를 피한다.
- production/customer data 사용 금지
- regression에는 재현 test가 필요하다.

자세한 내용은 [`docs/quality/test_strategy.md`](docs/quality/test_strategy.md)를 따른다.

## 문서

- 제품 동작 변경: product/spec 문서
- architecture 결정: ADR
- security boundary 변경: threat model/security baseline
- platform/성능 변경: quality 문서

Markdown은 명확한 제목, 상대 링크와 executable example을 사용한다.

## Commit과 Pull Request

- 한 commit에는 하나의 논리적 변경을 권장한다.
- 생성 파일과 lockfile 변경 이유를 포함한다.
- PR에 변경 목적, test, security 영향과 screenshot을 기록한다.
- UI 변경은 desktop/mobile 주요 viewport를 첨부한다.
- destructive migration과 capability 확대는 별도 강조한다.

## 보안

보안 취약점은 공개 issue에 올리지 않는다. [`SECURITY.md`](SECURITY.md)의 비공개 보고 절차를 따른다.

다음 변경은 security review가 필요하다.

- Tauri capability
- CSP
- credential/vault
- TLS
- generated SQL
- export/clipboard
- updater/signing
- remote content/network

## 라이선스

DBPod는 Apache License 2.0으로 배포된다. 별도 서면 합의가 없고 기여자가 명시적으로 다르게 표시하지 않는 한, 제출한 기여는 Apache License 2.0 Section 5에 따라 같은 조건으로 제공된다.

초기 프로젝트는 별도 CLA를 요구하지 않는다. 기여자는 제출물을 제공할 권리가 있고, 호환되지 않는 라이선스의 코드나 자산을 포함하지 않았음을 보장해야 한다.
