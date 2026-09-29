# src - React WebView

## OVERVIEW
Untrusted UI side: owns layout and user intent; everything privileged goes through typed IPC. Earned own file: 65 files, feature-sliced layout, distinct domain.

## STRUCTURE
```
src/
├── app/        # router (3 routes: /, /settings, /workspace/$connectionId), providers, shell (AppShell, WorkspacePage)
├── features/   # user features: connections, object-explorer, query-editor, result-grid, data-editing, query-history, saved-queries, settings, ai
├── entities/   # shared domain state: workspace, result, query, connection, settings, ai
├── shared/     # ipc/ (invoke.ts, queryChannel.ts), ui/, styles/
└── generated/  # ipc-types.ts from Rust - read-only
```

## WHERE TO LOOK
| Task | Location |
|------|----------|
| Call a Rust command | add to `ipc` in `shared/ipc/invoke.ts`; import types from `generated/ipc-types` |
| Query stream -> stores | `shared/ipc/queryChannel.ts` (switch over `QueryStreamEvent.type`, acks rows) |
| Tabs, sessions, per-connection workspace | `entities/workspace/workspaceStore.ts` + `persistence.ts` |
| Result rows | `entities/result/resultStore.ts`; pending edits `editStore.ts` |
| Grid rendering/selection/keyboard | `features/result-grid/ResultGrid.tsx` (712 lines) |
| Editability / save / TSV paste | `features/data-editing/` |
| Statement splitting, completion, format | `features/query-editor/` |
| Main workspace screen | `app/shell/WorkspacePage.tsx` (797 lines) |

## CONVENTIONS
- State ownership: route = TanStack Router, metadata = TanStack Query, workspace/tabs = external store, rows = `resultStore`, forms = TanStack Form, secrets = Rust only.
- Stores are module singletons read via `useSyncExternalStore`; snapshot identity changes per update.
- `resultStore` rows are mutated in place; always ack every `rows` event, even for stale executions.
- Features import from `entities/` and `shared/`, never another feature's internals.
- Relative imports (no `@/` alias). Discriminated unions for async/result status.
- Tests colocated as `*.test.ts(x)`; DOM tests need `// @vitest-environment jsdom`.

## ANTI-PATTERNS
- NO direct `invoke` from `@tauri-apps/api/core` in components; use `ipc`.
- NO copying result rows into React state.
- NO `any` outside boundary adapters.
- NO building connection strings, storing passwords, or generating write SQL here.
- NO SQL/rows/credentials in route params or search state.
- NO hand edits to `generated/`; change the Rust type and regenerate.
