import type { TransactionState } from "../../generated/ipc-types";
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
export type TableDataMode = "properties" | "data";

export type QueryTabState = {
  id: string;
  title: string;
  kind: "query" | "table-data" | "routine-definition";
  tableData?: TableDataTarget;
  tableDataMode?: TableDataMode;
  routineOid?: number;
  resultTabs: ResultTabState[];
  activeResultTabId?: string;
  runningExecutionId?: string;
  sessionId?: string;
  transactionState?: TransactionState;
};

export type WorkspaceState = {
  tabs: QueryTabState[];
  activeTabId?: string;
  tabGroups?: QueryTabGroup[];
  nextTabNumber: number;
  nextResultNumber: number;
};

export type QueryTabGroup = { id: string; tabIds: string[]; activeTabId?: string };

export type WorkspaceAction =
  | { type: "TAB_ADDED"; tabId: string; title?: string; tableData?: TableDataTarget; routineOid?: number; split?: boolean; groupId?: string }
  | { type: "TABLE_DATA_MODE_SET"; tabId: string; mode: TableDataMode }
  | { type: "TAB_CLOSED"; tabId: string }
  | { type: "TAB_RENAMED"; tabId: string; title: string }
  | { type: "TAB_ACTIVATED"; tabId: string }
  | { type: "TAB_ACTIVATED_BY_INDEX"; index: number }
  | { type: "TAB_CYCLED"; direction: 1 | -1 }
  | { type: "PANEL_CYCLED"; direction: 1 | -1 }
  | { type: "RESULT_ADDED"; tabId: string; resultTabId: string }
  | { type: "RESULT_CLOSED"; tabId: string; resultTabId: string }
  | { type: "RESULT_ACTIVATED"; tabId: string; resultTabId: string }
  | { type: "RESULT_PIN_TOGGLED"; tabId: string; resultTabId: string }
  | {
      type: "EXECUTION_STARTED";
      tabId: string;
      resultTabId: string;
      executionId: string;
      sessionId?: string;
    }
  | { type: "SESSION_OPENED"; tabId: string; sessionId: string }
  | { type: "EXECUTION_ENDED"; tabId: string; resultTabId: string; transactionState?: TransactionState };

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

/** Legacy/restored workspaces start with one tab group if pane data is unavailable. */
export function getTabGroups(state: WorkspaceState): QueryTabGroup[] {
  return state.tabGroups ?? [{ id: "main", tabIds: state.tabs.map((t) => t.id), activeTabId: state.activeTabId }];
}

function activateTab(state: WorkspaceState, tabId: string): WorkspaceState {
  if (state.activeTabId === tabId || !state.tabs.some((t) => t.id === tabId)) return state;
  return { ...state, activeTabId: tabId, tabGroups: getTabGroups(state).map((group) =>
    group.tabIds.includes(tabId) ? { ...group, activeTabId: tabId } : group) };
}

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "TAB_ADDED": {
      const tab: QueryTabState = {
        id: action.tabId,
        title: action.title ?? `Query ${state.nextTabNumber}`,
        kind: action.routineOid !== undefined ? "routine-definition" : action.tableData ? "table-data" : "query",
        tableData: action.tableData,
        tableDataMode: action.tableData ? "data" : undefined,
        routineOid: action.routineOid,
        resultTabs: [],
      };
      const groups = getTabGroups(state);
      const groupIndex = Math.max(0, groups.findIndex((group) => action.groupId
        ? group.id === action.groupId : group.tabIds.includes(state.activeTabId ?? "")));
      const tabGroups = [...groups];
      if (action.split && state.tabs.length) {
        tabGroups.splice(groupIndex + 1, 0, { id: tab.id, tabIds: [tab.id], activeTabId: tab.id });
      } else {
        const group = groups[groupIndex];
        tabGroups[groupIndex] = { ...group, tabIds: [...group.tabIds, tab.id], activeTabId: tab.id };
      }
      return {
        ...state,
        tabs: [...state.tabs, tab],
        activeTabId: tab.id,
        tabGroups,
        nextTabNumber: action.title ? state.nextTabNumber : state.nextTabNumber + 1,
      };
    }
    case "TABLE_DATA_MODE_SET":
      return updateTab(state, action.tabId, (t) => ({ ...t, tableDataMode: action.mode }));
    case "TAB_CLOSED": {
      const groups = getTabGroups(state);
      const groupIndex = groups.findIndex((group) => group.tabIds.includes(action.tabId));
      if (groupIndex < 0) return state;
      const group = groups[groupIndex];
      const idx = group.tabIds.indexOf(action.tabId);
      const tabs = state.tabs.filter((t) => t.id !== action.tabId);
      const tabIds = group.tabIds.filter((id) => id !== action.tabId);
      const nextGroup = { ...group, tabIds, activeTabId: group.activeTabId === action.tabId
        ? tabIds[Math.min(idx, tabIds.length - 1)] : group.activeTabId };
      const tabGroups = groups.flatMap((g, index) => index !== groupIndex ? [g] : tabIds.length ? [nextGroup] : []);
      const activeTabId = state.activeTabId === action.tabId
        ? nextGroup.activeTabId ?? tabGroups[Math.min(groupIndex, tabGroups.length - 1)]?.activeTabId
        : state.activeTabId;
      return { ...state, tabs, activeTabId, tabGroups: tabGroups.length ? tabGroups : undefined };
    }
    case "TAB_RENAMED":
      return updateTab(state, action.tabId, (t) => ({ ...t, title: action.title }));
    case "TAB_ACTIVATED":
      return activateTab(state, action.tabId);
    case "TAB_ACTIVATED_BY_INDEX": {
      const group = getTabGroups(state).find((g) => g.tabIds.includes(state.activeTabId ?? ""));
      const tabId = group?.tabIds[action.index];
      return tabId ? activateTab(state, tabId) : state;
    }
    case "TAB_CYCLED": {
      const tabIds = getTabGroups(state).flatMap((group) => group.tabIds);
      if (!tabIds.length) return state;
      const idx = tabIds.indexOf(state.activeTabId ?? "");
      const next = (Math.max(0, idx) + action.direction + tabIds.length) % tabIds.length;
      return activateTab(state, tabIds[next]);
    }
    case "PANEL_CYCLED": {
      const groups = getTabGroups(state);
      if (!groups.length) return state;
      const idx = Math.max(0, groups.findIndex((group) => group.tabIds.includes(state.activeTabId ?? "")));
      const next = (idx + action.direction + groups.length) % groups.length;
      const tabId = groups[next].activeTabId ?? groups[next].tabIds[0];
      return tabId ? activateTab(state, tabId) : state;
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
        sessionId: action.sessionId ?? t.sessionId,
        resultTabs: t.resultTabs.map((r) =>
          r.id === action.resultTabId ? { ...r, isRunning: true } : r,
        ),
      }));
    case "SESSION_OPENED":
      return updateTab(state, action.tabId, (t) => ({ ...t, sessionId: action.sessionId }));
    case "EXECUTION_ENDED":
      return updateTab(state, action.tabId, (t) => ({
        ...t,
        runningExecutionId: undefined,
        transactionState: action.transactionState ?? t.transactionState,
        resultTabs: t.resultTabs.map((r) =>
          r.id === action.resultTabId ? { ...r, isRunning: false } : r,
        ),
      }));
  }
}

/** Per-connection workspace state preserved across route switches (memory only). */
export const workspaceStates = new Map<string, WorkspaceState>();
const workspaceListeners = new Map<string, Set<() => void>>();

export function subscribeWorkspace(connectionId: string, listener: () => void): () => void {
  const listeners = workspaceListeners.get(connectionId) ?? new Set();
  workspaceListeners.set(connectionId, listeners);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) workspaceListeners.delete(connectionId);
  };
}

/** Async executions update their owning connection, including while its view is unmounted. */
export function dispatchWorkspace(connectionId: string, action: WorkspaceAction): void {
  const state = workspaceStates.get(connectionId);
  if (!state) return; // disconnected; late events must not resurrect a workspace
  workspaceStates.set(connectionId, workspaceReducer(state, action));
  workspaceListeners.get(connectionId)?.forEach((listener) => listener());
}

export function resultIds(tab: QueryTabState): string[] {
  return tab.kind === "table-data" ? [`${tab.id}:data`] : tab.resultTabs.map((r) => r.id);
}

/** SQL drafts live outside React state — CodeMirror is the source of truth. */
export const sqlDrafts = new Map<string, string>();

export type TableDataView = {
  offset: number;
  sortAttribute: number | null;
  sortDescending: boolean;
};

/** Table Data paging/sort state per tab (memory only). */
export const tableDataViews = new Map<string, TableDataView>();
