# PROJECT KNOWLEDGE BASE

**Generated:** 2026-09-29
**Commit:** 77114e3
**Branch:** main

## OVERVIEW
DBPod: PostgreSQL desktop client (TablePlus-style), macOS MVP. Tauri 2 + Rust core (sqlx 0.9, tokio) behind a React 19 WebView (TanStack Router/Query/Table/Virtual, CodeMirror 6, Tailwind 4).

## STRUCTURE
```
dbpod/
├── src/                # React WebView (untrusted side) - see src/AGENTS.md
│   └── generated/      # ipc-types.ts, emitted from Rust; never hand-edit
├── src-tauri/          # Rust core: credentials, sessions, SQL, persistence - see src-tauri/AGENTS.md
│   └── tests/          # integration tests; export_bindings.rs regenerates IPC types
├── docs/               # Korean-language spec set = implementation contract (product/spec/architecture/security/quality)
└── vitest.setup.ts     # in-memory localStorage shim for jsdom tests on Node 26
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Current verified scope | docs/plan/progress.md | Read before assuming a spec'd feature exists |
| Doc reading order / conflict priority | docs/README.md | Security > product scope > feature spec > design > ADR > README |
| Add/change an IPC command | src-tauri/src/commands/mod.rs, lib.rs `generate_handler!`, src/shared/ipc/invoke.ts | Three places, plus export_bindings decl! if new types |
| IPC contract rules | docs/architecture/ipc_contract.md | snake_case commands, camelCase args |
| Query streaming | infrastructure/postgres/session_actor.rs <-> src/shared/ipc/queryChannel.ts | ADR-0001, ACK backpressure |
| PG value encoding | domain/db_value.rs, infrastructure/postgres/decoder.rs | ADR-0002, lossless tagged union |
| Editable results / write SQL | application/edit_service.rs, src/features/data-editing/ | ADR-0003, data_editing_spec.md |
| Security boundaries | docs/security/threat_model.md, security_baseline.md | |

## CODE MAP
Centrality unmeasured (no LSP pass); roles from source.

| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `AppError` | struct | src-tauri/src/error.rs | Only error shape crossing IPC; redacted |
| `AppState` | struct | src-tauri/src/state/mod.rs | All runtime registries (workspaces, executions, change sets, AI jobs) |
| `build_connect_options` | fn | infrastructure/postgres/transport.rs | Sole place a PG connection is assembled |
| `DbValue` | enum | src-tauri/src/domain/db_value.rs | Wire representation of every cell |
| `QueryStreamEvent` | enum | src-tauri/src/domain/events.rs | Channel events: started/columns/rows/command/completed/failed/cancelled |
| `ipc` | object | src/shared/ipc/invoke.ts | Only typed wrapper around Tauri `invoke` |
| `resultStore` | singleton | src/entities/result/resultStore.ts | Out-of-React row storage |

## CONVENTIONS
- Docs before code: behavior diverging from `docs/` specs updates the spec/ADR in the same change. ADRs are superseded, never deleted.
- TDD: failing test first; regressions need a reproduction test.
- Rust serde types are the source of truth for IPC types; TS side consumes `src/generated/ipc-types.ts`.
- User-facing error strings are Korean.
- Package manager is pnpm (CI uses `--frozen-lockfile`), not npm/bun.

## ANTI-PATTERNS (THIS PROJECT)
- NEVER hand-edit `src/generated/ipc-types.ts`; CI fails on regeneration diff.
- NEVER log user SQL, query results, bind values, passwords or connection strings.
- NEVER let passwords/connection strings reach the WebView; React never builds connection strings or write SQL.
- NEVER put SQL, result rows or credentials in URLs/route search state.
- Changes to Tauri capability, CSP, vault, TLS, generated SQL, export/clipboard, updater, network need security review (CONTRIBUTING.md).
- Do not add abstractions beyond current scope; PostgreSQL-only MVP.
- No production/customer data in tests; no sleep-based waits.

## COMMANDS
```bash
pnpm install --frozen-lockfile
pnpm dev                 # vite only, port 1420 strict
pnpm tauri dev           # full app
pnpm typecheck           # == pnpm lint (both tsc --noEmit)
pnpm test                # vitest run
pnpm build               # tsc && vite build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml          # needs Docker (testcontainers PG 17)
(cd src-tauri && cargo test --test export_bindings)       # regenerate IPC types
```

## NOTES
- `cargo test` spins up PostgreSQL 17 containers; no Docker = integration tests fail, not skip.
- Vitest default env is `node`; DOM tests opt in with `// @vitest-environment jsdom` at file top.
- CI jobs: frontend (typecheck/test/build), rust (fmt/clippy/test/bindings drift), audit (cargo audit + pnpm audit high).
- Docs and CONTRIBUTING are Korean; code and comments are English.
