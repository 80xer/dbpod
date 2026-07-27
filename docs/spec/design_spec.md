# DBPod Layout Design Specification

- Status: MVP baseline
- Last updated: 2026-07-27
- Target: Desktop-first MVP with responsive mobile architecture
- Database: PostgreSQL

## 1. Purpose

This document defines the DBPod application shell, left sidebar, connection workspace, work tabs, query editor, result tabs, desktop layout, and mobile adaptation.

DBPod takes inspiration from the information architecture of TablePlus while implementing its own visual system and interaction rules. In particular, DBPod adopts the following ideas:

- Fast connection and database switching
- A searchable database object sidebar
- Pinned and recent objects
- Multiple workspaces and tabs
- Inline result editing
- Visible change review and commit actions
- Multiple query results

DBPod additionally provides an explicit command to execute a query in a new Result Tab. This is a DBPod-specific behavior and is not copied from TablePlus.

### Reference material

- [TablePlus interface](https://docs.tableplus.com/gui-tools/the-interface)
- [TablePlus left sidebar](https://docs.tableplus.com/gui-tools/the-interface/left-sidebar)
- [TablePlus toolbar](https://docs.tableplus.com/gui-tools/the-interface/toolbar)
- [TablePlus query editor](https://docs.tableplus.com/gui-tools/the-interface/query-editor)
- [TablePlus multiple tabs and workspaces](https://docs.tableplus.com/gui-tools/the-interface/multi-tabs-workspaces-windows)
- [TablePlus multiple query results](https://tableplus.com/blog/2018/08/show-multiple-results-separately.html)

## 2. Design principles

### 2.1 Desktop-first delivery, mobile-first layout rules

The desktop application is implemented and released first. Components and CSS must nevertheless work from narrow mobile layouts upward.

- Base Tailwind utilities describe the narrow layout.
- `md:` and `lg:` variants progressively add tablet and desktop behavior.
- Layout changes are based on available width rather than operating system.
- Resizable panels use container queries where viewport breakpoints are insufficient.
- Input behavior considers mouse, keyboard, touch, and external mobile keyboards.

### 2.2 Stable information hierarchy

The same conceptual hierarchy is used on every platform.

```text
Application
└── Connection Workspace
    └── Work Tabs
        ├── Query Tab
        │   └── Result Tabs
        ├── Table Data Tab
        └── Table Structure Tab
```

Desktop shows multiple levels at once. Mobile presents the same levels using switchers, drawers, and mode transitions.

### 2.3 Preserve user work

- SQL drafts must survive work tab and connection switches.
- Query results must survive work tab and connection switches during the current app session.
- Unsaved cell edits must never be replaced silently.
- Running results must never be replaced silently.
- Pinned results must never be replaced by a normal execution.
- Closing dirty or running content requires an explicit decision.

### 2.4 Security remains visible

- The active environment must remain visible.
- Production connections must show a text `PROD` badge, not color alone.
- TLS state and Safe Mode state must be discoverable without opening settings.
- Read-only connections must be visually distinct.
- Security indicators must not expose credentials or connection strings.

## 3. Terminology

| Term | Definition |
| --- | --- |
| Connection Profile | Persisted non-secret PostgreSQL connection configuration |
| Connection Workspace | Runtime UI state associated with one open connection |
| Connection Rail | Narrow leftmost switcher for open Connection Workspaces |
| Object Sidebar | Sidebar containing database objects for the active connection |
| Work Tab | Main workspace tab such as Query, Table Data, or Table Structure |
| Query Tab | Work Tab containing one SQL editor and zero or more Result Tabs |
| Result Panel | Resizable panel below the SQL editor |
| Result Tab | One execution result snapshot inside a Query Tab |
| Preview Tab | Replaceable Work Tab opened by single-clicking an object |
| Pinned Tab | Tab protected from automatic replacement |
| Dirty Result | Result containing uncommitted row or cell changes |

## 4. Desktop application shell

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Window Toolbar     DEV / app_db     TLS ✓     Safe Mode     Connected ● │
├──────┬───────────────────┬───────────────────────────────────────────────┤
│      │ Connection        │ [Query 1] [users] [Query 2 ●] [+]            │
│ Conn │ Database          ├───────────────────────────────────────────────┤
│ Rail │ [＋ Query] [↻]    │ [▶ Run] [▶＋] [Stop]  Limit 500  Read/Write │
│      ├───────────────────┤                                               │
│  D   │ Search objects    │                  SQL Editor                   │
│  S   ├───────────────────┤                                               │
│  P   │ Pinned            ├──────────── draggable splitter ──────────────┤
│      │ Recent            │ [Result 1 · 125] [Result 2 · 98] [Messages]  │
│      │ Tables            ├───────────────────────────────────────────────┤
│      │ Views             │ Save 3 changes   Preview SQL   Discard       │
│      │ Materialized      │                                               │
│      │ Functions         │                  Result Grid                  │
│      │ Sequences         │                                               │
│      │                   │                                               │
│      ├───────────────────┼───────────────────────────────────────────────┤
│      │ Schema / Options  │ Connected · user@host/db · verify-full       │
└──────┴───────────────────┴───────────────────────────────────────────────┘
```

### 4.1 Initial dimensions

| Region | Initial size | Constraint |
| --- | --- | --- |
| Window | 1280×800 | Minimum supported desktop viewport is 1024×640 |
| Window Toolbar | 44 px height | Platform title bar integration may change the effective height |
| Connection Rail | 48 px width | Fixed in desktop mode |
| Object Sidebar | 280 px width | Resizable from 220 px to 420 px |
| Work Tab Bar | 36 px height | Horizontally scrollable |
| Query Toolbar | 40 px height | May collapse low-priority actions |
| Editor/Result split | 45/55 | Stored per Query Tab |
| Status Bar | 24 px height | May be hidden in compact mobile layouts |

Dimensions are initial design tokens, not hardcoded values inside individual components.

## 5. Window Toolbar

The Window Toolbar exposes application-wide or connection-wide state.

### 5.1 Required items

- Toggle Object Sidebar
- Open Connection Switcher
- Active connection name
- Active database name
- Environment badge
- TLS status
- Safe Mode status
- Read-only status
- Connection state
- Global object search
- Application command palette

### 5.2 Connection identification

The toolbar and Connection Rail use the connection color as a secondary visual cue.

Required textual cues:

- Connection name
- Database name
- Environment tag such as `LOCAL`, `DEV`, `STAGE`, or `PROD`
- Read-only badge when applicable

Production state must not be communicated through red color alone.

## 6. Connection Rail

The Connection Rail is the leftmost vertical region and switches between open Connection Workspaces.

### 6.1 Connection item contents

- Connection icon or generated initials
- Connection color
- Environment badge or abbreviated marker
- Active state
- Connected, reconnecting, disconnected, or error state
- Aggregate running query indicator
- Aggregate dirty result indicator

### 6.2 Interactions

- Click: activate Connection Workspace
- Middle click: close workspace after safety checks
- Context menu:
  - Reconnect
  - Disconnect
  - Edit connection
  - Open another database
  - Close workspace
  - Close other workspaces
- Drag: reorder open workspaces
- Plus button: open the saved connections screen

### 6.3 Workspace isolation

Switching the active connection restores that workspace's:

- Active Work Tab
- Open Work Tabs and their order
- SQL drafts
- Result Tabs for the current app session
- Sidebar search and section expansion
- Selected schemas
- Editor/Result split sizes
- Grid scroll, sorting, selection, and edit buffers

Query result rows are not restored after an application restart. SQL drafts and non-sensitive layout state may be restored.

## 7. Object Sidebar

The Object Sidebar displays objects from the active Connection Workspace.

### 7.1 Sidebar layout

```text
┌──────────────────────────┐
│ Connection Name       ▾ │
│ Database Name         ▾ │
│ [＋ Query] [Refresh]    │
├──────────────────────────┤
│ Search objects…          │
├──────────────────────────┤
│ [Objects] [Favorite] [H] │
├──────────────────────────┤
│ Pinned                 3 │
│ Recent                 5 │
│ Tables               128 │
│ Views                 14 │
│ Materialized Views     2 │
│ Functions             23 │
│ Sequences              8 │
├──────────────────────────┤
│ Schema: public        ▾ │
│ Sidebar settings      ⚙ │
└──────────────────────────┘
```

### 7.2 Quick navigation

The sidebar header provides:

- Saved connection switcher
- Database switcher
- New Query Tab
- Refresh object metadata

Opening another PostgreSQL database may require a new pool because a PostgreSQL connection is bound to a database. The UI may present this as a database switch while the Rust Core creates or activates the appropriate Connection Workspace.

### 7.3 Sidebar modes

The sidebar has three modes:

1. Objects
2. Favorite Queries
3. Query History

The selected mode is stored per Connection Workspace.

### 7.4 Object sections

MVP sections:

- Pinned
- Recent
- Tables
- Views
- Materialized Views
- Functions
- Sequences

Post-MVP sections may include:

- Types
- Extensions
- Triggers
- Procedures
- Foreign Tables

### 7.5 Schema behavior

- `public` is initially selected when available.
- Multiple schemas may be selected.
- `information_schema`, `pg_catalog`, and `pg_toast` are hidden by default.
- System schemas can be enabled in sidebar settings.
- Schema selection affects the visible list but not fuzzy search when global search is enabled.
- Schema names appear as badges when objects from multiple schemas have the same name.

### 7.6 Search

Sidebar search uses fuzzy matching over loaded metadata.

It matches:

- Schema name
- Object name
- Qualified object name
- Object type

Search results are not limited to currently expanded tree nodes. Search text is local UI state and is not written to logs.

### 7.7 Pin and recent behavior

- Context menu action `Pin to top` adds an object to Pinned.
- Pinned objects are scoped to a connection profile and database.
- Recent contains the last five opened objects by default.
- Recent can be hidden in sidebar settings.
- Pinned and Recent sections are hidden when empty.

### 7.8 Opening objects

- Single click selects an object and opens it in a Preview Tab.
- Opening another object replaces the existing unmodified Preview Tab.
- Double click pins the opened Work Tab.
- `Cmd/Ctrl + Click` always opens a new pinned Work Tab.
- Starting an edit automatically pins the Work Tab.
- A Query Tab is pinned immediately when created.

## 8. Work Tab Bar

Work Tabs belong to the active Connection Workspace.

### 8.1 Work Tab types

```ts
type WorkTab =
  | QueryWorkTab
  | TableDataWorkTab
  | TableStructureWorkTab
```

### 8.2 Tab contents

Each tab displays:

- Type icon
- Title
- Dirty indicator
- Running indicator
- Error indicator
- Read-only indicator when applicable
- Close control on hover, focus, or active state

The close control must remain keyboard-accessible and cannot depend on hover alone.

### 8.3 Tab actions

- Rename
- Pin or unpin
- Duplicate Query Tab
- Close
- Close others
- Close tabs to the right
- Move left or right
- Move to a new window in a later desktop release

### 8.4 Closing safety

Closing a tab requires confirmation or an explicit action when it has:

- An unsaved SQL draft that is not being restored
- A running query
- A dirty Result Tab
- An active export

## 9. Query Tab

A Query Tab owns one SQL editor and multiple Result Tabs.

```text
Query Tab
├── Query Toolbar
├── CodeMirror SQL Editor
├── Resizable Splitter
└── Result Panel
    ├── Result Tab Bar
    ├── Result Toolbar
    └── Result Content
```

### 9.1 Query Toolbar

Required controls:

- Run
- Run in New Result Tab
- Stop
- Execution scope indicator
- Result row limit
- Read-only state
- Safe Mode state
- Current execution duration

Primary desktop controls:

```text
[▶ Run] [▶＋] [■ Stop]   Scope: Current   Limit: 500
```

The Run button may use a menu for secondary commands:

```text
Run
├── Run Current Query
├── Run in New Result Tab
└── Explain
```

`Run All` is outside the initial MVP behavior until multi-statement transaction and result grouping semantics are specified.

### 9.2 Execution scope

For the MVP:

- If text is selected, execute the selection.
- Otherwise, execute the SQL statement at the cursor.
- One execution action produces one Result Tab output.
- Empty or whitespace-only input does not invoke Rust Core.

### 9.3 Editor and Result Panel

- The panes are separated by a draggable horizontal splitter.
- The initial split is 45% editor and 55% result.
- Each Query Tab stores its own split ratio.
- The Result Panel can be collapsed.
- The Result Panel can temporarily fill the main area.
- The editor and result must each preserve at least the configured minimum usable height.

## 10. Query execution commands

### 10.1 Default execution

Command: `Run Current Query`

Shortcut: `Cmd/Ctrl + Enter`

Behavior:

1. Execute the selected SQL or statement at the cursor.
2. If there is no Result Tab, create `Result 1`.
3. Otherwise, replace the active Result Tab.
4. Keep the same Result Tab identity and position when replacing it.
5. Reset result-only sorting, selection, and scroll state for the new output.
6. Never replace a protected Result Tab.

### 10.2 Execute in a new Result Tab

Command: `Run Query in New Result Tab`

Shortcut: `Cmd/Ctrl + Shift + Enter`

Behavior:

1. Create a Result Tab at the right side of the current Result Tab.
2. Activate the new Result Tab immediately.
3. Show its running state while the query executes.
4. Populate it with rows, a command result, or an error.
5. Keep every existing Result Tab unchanged.

This command is a defining DBPod feature for comparing query variants or snapshots without creating another SQL editor.

### 10.3 Cancellation

Commands:

- `Cancel Current Query`
- `Cancel Execution`

Shortcuts:

- `Esc` when focus is in the active Query Tab and a query is running
- `Cmd/Ctrl + .`

Cancellation targets an opaque `executionId`; it must not cancel unrelated Query Tabs.

### 10.4 Concurrency

MVP rules:

- A Query Tab can have at most one running execution.
- Different Query Tabs may execute concurrently.
- A new execution request in an already-running Query Tab is rejected with an actionable message.
- Result-level parallel execution may be added later.

## 11. Result Tabs

Result Tabs represent execution result snapshots.

### 11.1 Creation and replacement

Example:

1. `Cmd/Ctrl + Enter` creates `Result 1`.
2. Editing SQL and pressing `Cmd/Ctrl + Enter` replaces `Result 1`.
3. Pressing `Cmd/Ctrl + Shift + Enter` creates `Result 2`.
4. Pressing it again creates `Result 3`.

```text
[Result 1 · users · 125] [Result 2 · users · 98] [Result 3 · Error]
```

### 11.2 Protected results

A Result Tab is protected from replacement when:

- It is pinned.
- It has pending cell or row edits.
- It has an active export.
- It is running.

When default execution is requested while the active Result Tab is protected, DBPod automatically creates a new Result Tab and shows a brief explanation.

### 11.3 Result Tab title

Before completion:

```text
Result 2 · Running…
```

After completion:

```text
Result 2 · users · 125
Result 3 · UPDATE · 4
Result 4 · Error
Result 5 · Cancelled
```

The tooltip or details menu shows:

- Executed SQL
- Execution timestamp
- Duration
- Row count or affected row count
- Status
- Editability
- Pin state

### 11.4 Result Tab state

```ts
type ResultTab = {
  id: string
  queryTabId: string
  executionId: string
  title: string
  executedSql: string
  executedAt: string
  status: 'running' | 'success' | 'error' | 'cancelled'
  kind: 'rows' | 'command' | 'error'
  rowCount?: number
  affectedRowCount?: number
  durationMs?: number
  isPinned: boolean
  isEditable: boolean
  pendingChangeCount: number
}
```

Result row data and sensitive cell values remain in an in-memory result store and are not placed in Router state, URLs, or persisted TanStack Query cache.

### 11.5 Result Tab actions

- Pin or unpin
- Rename
- Copy executed SQL
- Replace editor SQL with executed SQL after confirmation
- Execute snapshot again
- Execute snapshot in a new Result Tab
- Export
- Close
- Close others
- Close tabs to the right

Closing a dirty or running Result Tab requires an explicit decision.

## 12. Result Toolbar

The Result Toolbar is scoped to the active Result Tab.

### 12.1 Required controls

- Add row
- Delete selected rows
- Save changes
- Preview generated SQL
- Discard changes
- Filter
- Refresh or re-execute
- Export
- Toggle row detail
- Full-screen result
- Row count
- Execution duration

### 12.2 Change actions

```text
[Save 3 changes] [Preview SQL] [Discard] [＋ Row] [Delete]
```

- Save, Preview SQL, and Discard are visible only when relevant.
- Pending change count appears in both Result Tab and Work Tab.
- Save uses one explicit transaction for the active Result Tab.
- Switching Result Tabs preserves each tab's independent edit buffer.
- Saving one Result Tab does not commit another Result Tab's changes.

## 13. Result Grid

The grid combines TanStack Table, TanStack Virtual, and DBPod-specific interaction code.

### 13.1 Desktop interactions

- Single click selects a cell.
- Double click begins inline editing.
- Enter begins editing or confirms the active editor.
- Escape cancels the current cell edit.
- Tab commits the current cell draft and moves focus.
- Drag selects a range.
- Copy produces TSV by default.
- Paste maps TSV from the focused cell.
- Space opens row detail when the grid has focus.

### 13.2 Editability

Inline editing is available only when:

- The result maps to one base table.
- A primary key or safe unique key exists.
- The source columns are identifiable.
- The connection is not read-only.
- The result is not stale because of a detected conflicting update.

Other results remain selectable and copyable but are read-only.

### 13.3 Grid states

The Result Content region must define:

- Initial empty state
- Running state
- Streaming or loading state
- Successful zero-row state
- Successful row result
- Command result
- Error state
- Cancelled state
- Disconnected state
- Stale editable result state

## 14. Status Bar

The desktop Status Bar displays non-secret connection state.

```text
Connected · username@hostname/database · PostgreSQL · verify-full · 42 ms
```

It may include:

- Connected, reconnecting, disconnected, or error
- Username
- Hostname
- Database
- Server version
- TLS mode
- Latest latency
- Active transaction state
- Read-only state

Passwords, private key paths, complete connection URLs, and tokens must never appear.

## 15. Responsive behavior

### 15.1 Layout modes

| Width | Layout |
| --- | --- |
| `< md` | Mobile shell |
| `md` to `< lg` | Tablet/compact shell |
| `lg+` | Full desktop shell |

### 15.2 Tablet

- Connection Rail may remain visible in landscape.
- Object Sidebar becomes collapsible.
- Editor and Result Panel remain vertically split when space permits.
- Low-priority toolbar actions move into overflow menus.
- Touch density is enabled when the primary pointer is coarse.

### 15.3 Mobile

```text
┌────────────────────────────┐
│ DEV / app_db          [☰] │
├────────────────────────────┤
│ [Query 1] [users] [+]  →  │
├────────────────────────────┤
│ [Editor] [Results]         │
├────────────────────────────┤
│                            │
│ Editor or Result Content   │
│                            │
├────────────────────────────┤
│ [Result 1] [Result 2]  →  │
├────────────────────────────┤
│ [▶ Run] [▶＋] [■ Stop]    │
└────────────────────────────┘
```

Mobile transformations:

- Connection Rail becomes a Connection Switcher Sheet.
- Object Sidebar becomes a full-height Drawer.
- Editor and Results use a segmented mode switcher.
- Result Tabs remain horizontally scrollable.
- Query actions move to a safe-area-aware bottom action bar.
- Inline cell editing becomes a Bottom Sheet or full-screen field editor.
- Row detail becomes a full-screen editor for wide records.
- Multi-row paste uses a dedicated Import Sheet with preview.
- External keyboards retain desktop shortcuts.
- Run in New Result Tab has a visible button and does not depend on long press.

### 15.4 Mobile privacy

- Sensitive content is obscured in background task snapshots.
- Clipboard access occurs only after explicit user actions.
- Password fields do not offer copy actions.
- Safe area insets are applied to top and bottom controls.

## 16. Tailwind implementation rules

- Use semantic tokens such as `background`, `surface`, `muted`, `border`, `accent`, `warning`, and `danger`.
- Do not repeat literal product colors throughout components.
- Support Light, Dark, and System themes.
- Use compact desktop density and comfortable coarse-pointer density.
- Use `pointer-coarse:` for larger controls and grid hit targets.
- Do not hide required actions behind `hover:` only.
- Use `focus-visible:` consistently.
- Respect `prefers-reduced-motion`.
- Support high contrast and forced color environments.
- Use `h-dvh` and safe-area variables on mobile.
- Bundle fonts, icons, CSS, and scripts locally.
- Do not load UI assets from a CDN.

## 17. Keyboard behavior

| Scope | Action | Shortcut |
| --- | --- | --- |
| Query Tab | Run selected SQL or current statement | `Cmd/Ctrl + Enter` |
| Query Tab | Run in New Result Tab | `Cmd/Ctrl + Shift + Enter` |
| Query Tab | Cancel current execution | `Esc` or `Cmd/Ctrl + .` |
| Work Tabs | Next Work Tab | `Ctrl + Tab` |
| Work Tabs | Previous Work Tab | `Ctrl + Shift + Tab` |
| Work Tabs | Select numbered Work Tab | `Cmd/Ctrl + 1~9` |
| Workspace | New Query Tab | Configurable; must not conflict with new Result execution |
| Sidebar | Focus object search | `Cmd/Ctrl + P` or command palette mapping |

Shortcuts are app-local key bindings, not OS-global shortcuts. All shortcut actions require accessible touch and pointer alternatives.

## 18. Accessibility

- All tab bars use correct tab roles and keyboard navigation.
- Connection items and tabs have accessible names containing their type and state.
- Running, dirty, pinned, error, and read-only states are not represented by color alone.
- Splitters are keyboard-adjustable and expose separator semantics.
- Grid cells expose row and column context.
- Focus remains visible in the editor, tab bars, sidebars, toolbars, and grid.
- Closing or replacing focused content moves focus to a predictable neighbor.
- Mobile touch targets use comfortable sizing.
- Motion is reduced when requested by the operating system.

## 19. State ownership

```ts
type AppWorkspaceState = {
  activeConnectionWorkspaceId?: string
  connectionWorkspaces: ConnectionWorkspaceState[]
}

type ConnectionWorkspaceState = {
  id: string
  connectionId: string
  activeWorkTabId?: string
  workTabs: WorkTab[]
  sidebar: SidebarState
}

type QueryWorkTab = {
  id: string
  type: 'query'
  title: string
  sql: string
  activeResultTabId?: string
  resultTabs: ResultTab[]
  splitRatio: number
  status: 'idle' | 'running' | 'success' | 'error'
  isDirty: boolean
}
```

Ownership rules:

- Router owns application-level screens, not SQL or result state.
- Workspace state owns open connections and Work Tabs.
- Query Tab state owns editor content and Result Tab metadata.
- The in-memory result store owns columns, rows, grid state, and edit buffers.
- TanStack Query owns reconnectable server metadata such as schemas and object lists.
- Tauri Store may persist non-secret layout preferences and SQL drafts.
- The credential vault owns all secrets.

## 20. Performance rules

- Sidebar metadata is loaded lazily by section or schema.
- Fuzzy search runs against indexed loaded metadata.
- Result rows use TanStack Virtual.
- Very large results use row limits and incremental loading.
- Result Tab labels and running indicators must not cause the full grid to rerender.
- Switching Result Tabs preserves state without keeping unnecessary DOM trees mounted.
- Closing a Result Tab releases its in-memory row data.
- Closing a Connection Workspace releases all associated pools and result data after safety checks.

## 21. Acceptance criteria

### Desktop

- Multiple Connection Workspaces can be opened and switched without losing their Work Tabs.
- Each connection maintains an independent Work Tab list.
- A Query Tab can contain multiple Result Tabs.
- `Cmd/Ctrl + Enter` creates or replaces the active unprotected Result Tab.
- `Cmd/Ctrl + Shift + Enter` always creates a new Result Tab.
- Pinned, dirty, exporting, or running Result Tabs are never overwritten.
- The Object Sidebar supports fuzzy search, Pinned, Recent, object sections, and schema filtering.
- The Object Sidebar and editor/result splitter are resizable.
- Query results remain available while switching Work Tabs and connections during the session.
- Closing dirty or running content requires an explicit choice.

### Mobile and tablet

- Connection switching is available without the desktop Connection Rail.
- Database objects are available through a Drawer.
- Editor and Results can be switched without losing state.
- Result Tabs remain individually selectable.
- Run and Run in New Result Tab are both directly accessible.
- External keyboard shortcuts behave consistently.
- Cell editing and multi-row paste work without requiring precise desktop pointer interactions.

### Security and privacy

- No credential appears in visual state, Router state, logs, or persisted result state.
- TLS and environment state are visible without revealing secrets.
- Production state is not represented by color alone.
- Result rows are removed from memory when their Result Tab is closed.
- Background mobile snapshots obscure sensitive result data.
