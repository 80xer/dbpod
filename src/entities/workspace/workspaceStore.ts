export type ResultTabState = {
  id: string;
  title: string;
  isPinned: boolean;
  isRunning: boolean;
};

export type TableDataTarget = {
  relationOid: number;
  schema: string;
  name: string;
};

export type QueryTabState = {
  id: string;
  title: string;
  kind: "query" | "table-data";
  tableData?: TableDataTarget;
  resultTabs: ResultTabState[];
  activeResultTabId?: string;
  runningExecutionId?: string;
  sessionId?: string;
};

export type WorkspaceState = {
  tabs: QueryTabState[];
  activeTabId?: string;
  nextTabNumber: number;
  nextResultNumber: number;
};

export type WorkspaceAction =
  | { type: "TAB_ADDED"; tabId: string; title?: string; tableData?: TableDataTarget }
  | { type: "TAB_CLOSED"; tabId: string }
  | { type: "TAB_RENAMED"; tabId: string; title: string }
  | { type: "TAB_ACTIVATED"; tabId: string }
  | { type: "TAB_ACTIVATED_BY_INDEX"; index: number }
  | { type: "TAB_CYCLED"; direction: 1 | -1 }
  | { type: "RESULT_ADDED"; tabId: string; resultTabId: string }
  | { type: "RESULT_CLOSED"; tabId: string; resultTabId: string }
  | { type: "RESULT_ACTIVATED"; tabId: string; resultTabId: string }
  | { type: "RESULT_PIN_TOGGLED"; tabId: string; resultTabId: string }
  | {
      type: "EXECUTION_STARTED";
      tabId: string;
      resultTabId: string;
      executionId: string;
      sessionId: string;
    }
  | { type: "EXECUTION_ENDED"; tabId: string; resultTabId: string };

export const emptyWorkspace = (): WorkspaceState => ({
  tabs: [],
  activeTabId: undefined,
  nextTabNumber: 1,
  nextResultNumber: 1,
});

function updateTab(
  state: WorkspaceState,
  tabId: string,
  fn: (t: QueryTabState) => QueryTabState,
): WorkspaceState {
  return { ...state, tabs: state.tabs.map((t) => (t.id === tabId ? fn(t) : t)) };
}

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "TAB_ADDED": {
      const tab: QueryTabState = {
        id: action.tabId,
        title: action.title ?? `Query ${state.nextTabNumber}`,
        kind: action.tableData ? "table-data" : "query",
        tableData: action.tableData,
        resultTabs: [],
      };
      return {
        ...state,
        tabs: [...state.tabs, tab],
        activeTabId: tab.id,
        nextTabNumber: action.title ? state.nextTabNumber : state.nextTabNumber + 1,
      };
    }
    case "TAB_CLOSED": {
      const idx = state.tabs.findIndex((t) => t.id === action.tabId);
      const tabs = state.tabs.filter((t) => t.id !== action.tabId);
      const activeTabId =
        state.activeTabId === action.tabId
          ? (tabs[Math.min(idx, tabs.length - 1)]?.id ?? undefined)
          : state.activeTabId;
      return { ...state, tabs, activeTabId };
    }
    case "TAB_RENAMED":
      return updateTab(state, action.tabId, (t) => ({ ...t, title: action.title }));
    case "TAB_ACTIVATED":
      return { ...state, activeTabId: action.tabId };
    case "TAB_ACTIVATED_BY_INDEX": {
      const tab = state.tabs[action.index];
      return tab ? { ...state, activeTabId: tab.id } : state;
    }
    case "TAB_CYCLED": {
      if (state.tabs.length === 0) return state;
      const idx = state.tabs.findIndex((t) => t.id === state.activeTabId);
      const next = (idx + action.direction + state.tabs.length) % state.tabs.length;
      return { ...state, activeTabId: state.tabs[next].id };
    }
    case "RESULT_ADDED": {
      const s = updateTab(state, action.tabId, (t) => ({
        ...t,
        resultTabs: [
          ...t.resultTabs,
          {
            id: action.resultTabId,
            title: `Result ${state.nextResultNumber}`,
            isPinned: false,
            isRunning: false,
          },
        ],
        activeResultTabId: action.resultTabId,
      }));
      return { ...s, nextResultNumber: state.nextResultNumber + 1 };
    }
    case "RESULT_CLOSED":
      return updateTab(state, action.tabId, (t) => {
        const idx = t.resultTabs.findIndex((r) => r.id === action.resultTabId);
        const resultTabs = t.resultTabs.filter((r) => r.id !== action.resultTabId);
        const activeResultTabId =
          t.activeResultTabId === action.resultTabId
            ? (resultTabs[Math.min(idx, resultTabs.length - 1)]?.id ?? undefined)
            : t.activeResultTabId;
        return { ...t, resultTabs, activeResultTabId };
      });
    case "RESULT_ACTIVATED":
      return updateTab(state, action.tabId, (t) => ({
        ...t,
        activeResultTabId: action.resultTabId,
      }));
    case "RESULT_PIN_TOGGLED":
      return updateTab(state, action.tabId, (t) => ({
        ...t,
        resultTabs: t.resultTabs.map((r) =>
          r.id === action.resultTabId ? { ...r, isPinned: !r.isPinned } : r,
        ),
      }));
    case "EXECUTION_STARTED":
      return updateTab(state, action.tabId, (t) => ({
        ...t,
        runningExecutionId: action.executionId,
        sessionId: action.sessionId,
        resultTabs: t.resultTabs.map((r) =>
          r.id === action.resultTabId ? { ...r, isRunning: true } : r,
        ),
      }));
    case "EXECUTION_ENDED":
      return updateTab(state, action.tabId, (t) => ({
        ...t,
        runningExecutionId: undefined,
        resultTabs: t.resultTabs.map((r) =>
          r.id === action.resultTabId ? { ...r, isRunning: false } : r,
        ),
      }));
  }
}

/** Per-connection workspace state preserved across route switches (memory only). */
export const workspaceStates = new Map<string, WorkspaceState>();

/** SQL drafts live outside React state — CodeMirror is the source of truth. */
export const sqlDrafts = new Map<string, string>();

export type TableDataView = {
  offset: number;
  sortAttribute: number | null;
  sortDescending: boolean;
};

/** Table Data paging/sort state per tab (memory only). */
export const tableDataViews = new Map<string, TableDataView>();
