# src-tauri - Rust Core

## OVERVIEW
Trusted side: owns credentials, PG sessions, SQL execution, value decode, generated write SQL, encrypted persistence. Earned own file: separate crate (`dbpod_lib`), 40 files, distinct domain.

## LAYERS (src/)
| Layer | Role | Rule |
|-------|------|------|
| `commands/` | Tauri adapters | Deserialize, validate, call service, return `AppError`. No business rules |
| `application/` | Use cases: connection, query, metadata, edit services | Orchestrates domain + infrastructure |
| `domain/` | serde/ts-rs types, framework-free rules | No sqlx/tauri deps |
| `infrastructure/postgres/` | session actor, decoder, large values, transport | Query Tab execution path; services also run metadata/edit SQL via sqlx directly |
| `infrastructure/persistence/` | profiles store, AES-256-GCM workspace snapshot | |
| `infrastructure/platform/` | OS keychain (`keyring`) | |
| `state/` | `AppState` registries keyed by opaque ids | |

## WHERE TO LOOK
| Task | Location |
|------|----------|
| New command | `commands/mod.rs` + register in `lib.rs` `generate_handler!` |
| New IPC type | derive `TS` in `domain/`, add `decl!` in `tests/export_bindings.rs`, rerun it |
| Execution / cancel / backpressure | `infrastructure/postgres/session_actor.rs` (one actor per Query Tab, ADR-0005) |
| Type decoding | `infrastructure/postgres/decoder.rs`, `domain/db_value.rs` |
| Oversized values | `infrastructure/postgres/large_values.rs` (out-of-band, per Result Tab) |
| INSERT/UPDATE/DELETE plans, xmin conflicts | `application/edit_service.rs` (815 lines, largest file) |
| AI chat panel (spawns claude/codex CLI) | `commands/mod.rs` top: `ai_chat*`, `AI_ALLOWED_TOOLS` |
| Error mapping from sqlx | `error.rs` `AppError::from_sqlx` |

## CONVENTIONS
- `#![allow(clippy::result_large_err)]` crate-wide: return `Result<_, AppError>` unboxed.
- Streaming uses `tauri::ipc::Channel` per execution, never global events. `MAX_UNACKED_CHUNKS = 2`; first chunk 50 rows, then 100.
- `EventSink` returns `false` when the webview is gone; execution must stop, not buffer.
- Every frontend-supplied id is re-validated against `AppState` registries.
- Registry entries use Drop guards (`JobGuard`) so early returns never strand entries.
- Metadata and atomic edit transactions serialize on `Workspace.control`; cancel uses a separate connection.
- Secret-bearing types must not derive/print `Debug`; `connect_opts` lives only in Rust memory.

## ANTI-PATTERNS
- No `unsafe`; no `panic!`/`unwrap` on user-input paths.
- Generated write SQL MUST bind values; never format values into SQL text.
- Do NOT add filesystem tools (or `run_query`) to `AI_ALLOWED_TOOLS`: DB row text is prompt-injection input.
- Do NOT assemble `PgConnectOptions` outside `transport.rs`.
- Do NOT remove the `windows_subsystem` line in `main.rs`.
- Every async task/Channel needs a cancellation + cleanup path.
- Widening `capabilities/default.json` or the CSP in `tauri.conf.json` needs security review.

## TESTS (tests/)
- `postgres_integration.rs`, `query_regressions.rs` (~1.4k lines each): testcontainers `postgres:17-alpine`, helper `setup()` builds `AppState` on a temp dir.
- `type_regressions.rs`: decode edge cases. `vault_smoke.rs`: real keychain.
- `export_bindings.rs`: not a test in spirit; writes `../src/generated/ipc-types.ts`.
- Await with `tokio::time::timeout` on channel receivers, never sleeps.
