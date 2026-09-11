import { historyStore } from "../../entities/query/historyStore";
import type { EditorView } from "@codemirror/view";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { openConnections, useOpenConnections } from "../../entities/connection/openConnections";
import { environmentStyles } from "../../entities/connection/environmentStyles";
import { editStore } from "../../entities/result/editStore";
import { resultStore } from "../../entities/result/resultStore";
import { restoreWorkspace, saveWorkspaceNow, saveWorkspaceSoon } from "../../entities/workspace/persistence";
import {
  emptyWorkspace,
  getTabGroups,
  sqlDrafts,
  dispatchWorkspace,
  subscribeWorkspace,
  resultIds,
  tableDataViews,
  workspaceStates,
  workspaceReducer,
  type QueryTabState,
} from "../../entities/workspace/workspaceStore";
import { ObjectSidebar } from "../../features/object-explorer/ObjectSidebar";
import { HistoryPanel } from "../../features/query-history/HistoryPanel";
import type { DatabaseObjectSummary } from "../../generated/ipc-types";
import {
  firstKeyword,
  statementAt,
  stripLiterals,
} from "../../features/query-editor/statementSplitter";
import { ipc } from "../../shared/ipc/invoke";
import { runQuery } from "../../shared/ipc/queryChannel";
import { getAppSettings } from "../../entities/settings/appSettings";
import { displayShortcut, shortcutDigit, shortcutMatches, type ShortcutId } from "../../entities/settings/shortcuts";

import { WorkspacePane } from "./WorkspacePane";

const tabBtn = (active: boolean) =>
  `group flex shrink-0 items-center gap-1 rounded-t border-x border-t px-2 py-1 text-xs ${
    active
      ? "border-gray-300 bg-white font-medium"
      : "border-transparent bg-gray-100 text-gray-600 hover:bg-gray-200"
  }`;

export function WorkspacePage() {
  const { connectionId } = useParams({ from: "/workspace/$connectionId" });
  const connections = useOpenConnections();
  const database = connections.find(([id]) => id === connectionId)?.[1].database;
  return <WorkspaceContent key={`${connectionId}:${database}`} connectionId={connectionId} />;
}

function WorkspaceContent({ connectionId }: { connectionId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const profile = openConnections.get(connectionId);

  useState(() => {
    if (!workspaceStates.has(connectionId)) {
      const initial = (profile && restoreWorkspace(profile.id, profile.database)) ?? emptyWorkspace();
      workspaceStates.set(connectionId, initial.tabs.length ? initial
        : workspaceReducer(initial, { type: "TAB_ADDED", tabId: crypto.randomUUID() }));
    }
  });
  const dispatch = useCallback((action: Parameters<typeof dispatchWorkspace>[1]) => dispatchWorkspace(connectionId, action), [connectionId]);
  const state = useSyncExternalStore(
    useCallback((listener: () => void) => subscribeWorkspace(connectionId, listener), [connectionId]),
    () => workspaceStates.get(connectionId)!,
  );
  useEffect(saveWorkspaceSoon, [state]);
  useEffect(() => {
    if (state.tabs.length === 0) dispatch({ type: "TAB_ADDED", tabId: crypto.randomUUID() });
  }, [state.tabs.length, dispatch]);

  const [notice, setNotice] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(224);
  const sidebarResizeStart = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [changingDatabase, setChangingDatabase] = useState(false);
  const editorViews = useRef(new Map<string, EditorView>());
  const focusEditor = useRef<string | null>(null);
  const closeActiveTabRef = useRef<() => void>(() => undefined);

  const activeTab = state.tabs.find((t) => t.id === state.activeTabId);
  const running = Boolean(activeTab?.runningExecutionId);
  const dispatchAndFocusEditor = useCallback((action: Parameters<typeof dispatch>[0]) => {
    dispatch(action);
    focusEditor.current = workspaceStates.get(connectionId)?.activeTabId ?? null;
    const view = editorViews.current.get(focusEditor.current ?? "");
    if (view) {
      focusEditor.current = null;
      view.focus();
    }
  }, [connectionId, dispatch]);
  const addQueryTab = useCallback((split = false, groupId?: string) => {
    dispatchAndFocusEditor({ type: "TAB_ADDED", tabId: crypto.randomUUID(), split, groupId });
  }, [dispatchAndFocusEditor]);

  useEffect(() => {
    if (!profile) void navigate({ to: "/" });
  }, [profile, navigate]);

  // Capture workspace navigation before CodeMirror handles the same key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (changingDatabase || e.isComposing) return;
      const shortcuts = getAppSettings().shortcuts;
      const matches = (id: ShortcutId) => shortcutMatches(e, shortcuts[id]);
      let action: Parameters<typeof dispatch>[0] | null = null;
      if (matches("splitPanel")) {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) addQueryTab(true);
        return;
      }
      if (matches("closeTab")) {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) closeActiveTabRef.current();
        return;
      }
      if (matches("previousPanel")) action = { type: "PANEL_CYCLED", direction: -1 };
      else if (matches("nextPanel")) action = { type: "PANEL_CYCLED", direction: 1 };
      else if (matches("previousTab") || matches("previousTabArrow")) action = { type: "TAB_CYCLED", direction: -1 };
      else if (matches("nextTab") || matches("nextTabArrow")) action = { type: "TAB_CYCLED", direction: 1 };
      else if (matches("tabByNumber")) {
        const digit = shortcutDigit(e);
        if (digit) action = { type: "TAB_ACTIVATED_BY_INDEX", index: digit - 1 };
      }
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      dispatchAndFocusEditor(action);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dispatchAndFocusEditor, changingDatabase, addQueryTab]);

  if (!profile) return null;

  const pickSql = (tabId: string): string | null => {
    const view = editorViews.current.get(tabId);
    if (!view) return null;
    const { from, to } = view.state.selection.main;
    if (from !== to) return view.state.sliceDoc(from, to).trim() || null;
    return statementAt(view.state.doc.toString(), from)?.sql ?? null;
  };

  const run = async (mode: "replace" | "new-result", tab = activeTab) => {
    if (changingDatabase || !tab || tab.kind !== "query" || tab.runningExecutionId) return;
    const sql = pickSql(tab.id);
    if (!sql) {
      setNotice("실행할 SQL이 없습니다.");
      return;
    }
    // Accident-prevention UX, not a security boundary (that's the DB role).
    const keyword = firstKeyword(sql);
    if (keyword === "DROP" || keyword === "TRUNCATE") {
      if (!window.confirm(`${keyword} 문을 실행하려고 합니다. 계속할까요?\n\n${sql.slice(0, 200)}`))
        return;
    } else if (
      (keyword === "DELETE" || keyword === "UPDATE") &&
      !/\bWHERE\b/i.test(stripLiterals(sql))
    ) {
      if (
        !window.confirm(
          `WHERE 절이 없는 ${keyword} 문입니다. 전체 행에 적용될 수 있습니다. 계속할까요?`,
        )
      )
        return;
    }
    setNotice("");

    const active = tab.resultTabs.find((r) => r.id === tab.activeResultTabId);
    // Default run replaces the active unprotected result; pinned/running or
    // explicit new-result mode creates a fresh Result Tab on the right.
    const reuse = mode === "replace" && active && !active.isPinned && !active.isRunning && !editStore.getSnapshot(active.id).pendingCount && !editStore.getSnapshot(active.id).locked;
    const resultTabId = reuse ? active.id : crypto.randomUUID();
    if (!reuse) dispatch({ type: "RESULT_ADDED", tabId: tab.id, resultTabId });

    try {
      await runQuery({
        connectionId,
        queryTabId: tab.id,
        resultTabId,
        sql,
        maxRows: 0,
        timeoutMs: profile.queryTimeoutMs || 60_000,
      });
    } catch (e) {
      const err = e as { message?: string };
      setNotice(err?.message ?? String(e));
    }
  };

  const cancel = (tab = activeTab) => {
    if (tab?.runningExecutionId && !tab.runningExecutionId.startsWith("pending:"))
      void ipc.queryCancel({ executionId: tab.runningExecutionId }).catch((e: unknown) => setNotice((e as { message?: string }).message ?? String(e)));
  };

  const showError = (e: unknown) => setNotice((e as { message?: string })?.message ?? String(e));
  const changeDatabase = async (database: string) => {
    if (changingDatabase || database === profile.database) return;
    if (state.tabs.some((t) => t.runningExecutionId || (t.transactionState && t.transactionState !== "idle") || resultIds(t).some((id) => editStore.getSnapshot(id).locked))) {
      setNotice("쿼리 실행·저장을 완료하고 열린 트랜잭션을 종료한 후 DB를 변경해 주세요.");
      return;
    }
    if (state.tabs.some((t) => resultIds(t).some((id) => editStore.getSnapshot(id).pendingCount))
      && !window.confirm("DB를 변경하면 현재 조회 결과와 저장하지 않은 편집을 닫습니다. SQL 초안은 보관합니다. 계속할까요?")) return;
    setChangingDatabase(true);
    setNotice("");
    try {
      await saveWorkspaceNow();
      await queryClient.cancelQueries({ predicate: (q) => q.queryKey[1] === connectionId });
      const opened = await ipc.connectionSwitchDatabase({ connectionId, database });
      for (const tab of state.tabs) disposeTab(tab);
      historyStore.clear(connectionId);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[1] === connectionId });
      // The database key remounts the workspace while its connection item and route stay put.
      workspaceStates.delete(connectionId);
      openConnections.set(connectionId, { ...profile, database: opened.database });
    } catch (e) {
      showError(e);
      void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[1] === connectionId });
    }
    finally { setChangingDatabase(false); }
  };
  const protectedTabs = (tabs: QueryTabState[]): boolean => {
    if (tabs.some((t) => t.runningExecutionId?.startsWith("pending:")) || tabs.some((t) => resultIds(t).some((id) => editStore.getSnapshot(id).locked))) {
      setNotice("실행 준비 또는 저장 중입니다. 완료 후 닫아 주세요.");
      return true;
    }
    const dirty = tabs.some((t) => resultIds(t).some((id) => editStore.getSnapshot(id).pendingCount));
    const active = tabs.some((t) => t.runningExecutionId || (t.transactionState && t.transactionState !== "idle"));
    return (dirty || active) && !window.confirm("저장하지 않은 편집은 버리고, 실행 중인 쿼리는 취소하며 열린 트랜잭션은 롤백합니다. 계속할까요?");
  };
  const disposeTab = (tab: QueryTabState) => {
    for (const id of resultIds(tab)) resultStore.dispose(id);
    tableDataViews.delete(tab.id);
    sqlDrafts.delete(tab.id);
  };
  const closeResultTab = async (tab: QueryTabState, resultTabId: string) => {
    const r = tab.resultTabs.find((x) => x.id === resultTabId);
    const edits = editStore.getSnapshot(resultTabId);
    if (!r || r.isRunning || edits.locked) return;
    if ((r.isPinned || edits.pendingCount) && !window.confirm(`'${r.title}' 결과와 저장하지 않은 편집을 닫을까요?`)) return;
    try {
      await ipc.resultRelease({ resultTabId });
      resultStore.dispose(resultTabId);
      dispatch({ type: "RESULT_CLOSED", tabId: tab.id, resultTabId });
    } catch (e) { showError(e); }
  };

  const closeQueryTabs = async (tabs: QueryTabState[]) => {
    if (protectedTabs(tabs)) return;
    try {
      for (const tab of tabs) {
        if (tab.sessionId) await ipc.querySessionClose({ sessionId: tab.sessionId, rollbackOpenTransaction: true });
        for (const resultTabId of resultIds(tab)) await ipc.resultRelease({ resultTabId });
        disposeTab(tab);
        const close = { type: "TAB_CLOSED", tabId: tab.id } as const;
        if (workspaceStates.get(connectionId)?.activeTabId === tab.id) dispatchAndFocusEditor(close);
        else dispatch(close);
      }
    } catch (e) { showError(e); }
  };
  closeActiveTabRef.current = () => {
    const current = workspaceStates.get(connectionId);
    const tab = current?.tabs.find((item) => item.id === current.activeTabId);
    if (tab) void closeQueryTabs([tab]);
  };

  const disconnect = async () => {
    if (protectedTabs(state.tabs)) return;
    try {
      // Keep drafts available until encrypted persistence and backend cleanup succeed.
      await saveWorkspaceNow();
      await ipc.connectionClose({ connectionId });
      for (const tab of state.tabs) disposeTab(tab);
      historyStore.clear(connectionId);
      openConnections.delete(connectionId);
      await navigate({ to: "/" });
      workspaceStates.delete(connectionId);
    } catch (e) { showError(e); }
  };

  const renameTab = (tab: QueryTabState) => {
    const title = window.prompt("탭 이름", tab.title);
    if (title?.trim()) dispatch({ type: "TAB_RENAMED", tabId: tab.id, title: title.trim() });
  };

  const openObject = (o: DatabaseObjectSummary) => {
    if (o.kind === "function") {
      const existing = state.tabs.find((t) => t.kind === "routine-definition" && t.routineOid === o.oid);
      if (existing) dispatch({ type: "TAB_ACTIVATED", tabId: existing.id });
      else dispatch({ type: "TAB_ADDED", tabId: crypto.randomUUID(), routineOid: o.oid,
        title: `${o.schema}.${o.name}(${o.functionArguments ?? ""})` });
      return;
    }
    dispatch({
      type: "TAB_ADDED",
      tabId: crypto.randomUUID(),
      title: o.name,
      tableData: { relationOid: o.oid, schema: o.schema, name: o.name },
    });
  };

  const isQueryTab = activeTab?.kind === "query";
  const groups = getTabGroups(state);
  const shortcuts = getAppSettings().shortcuts;

  return (
    <div className="flex h-full min-h-0 flex-col" inert={changingDatabase} aria-busy={changingDatabase}>
      <div className={`flex shrink-0 items-center gap-2 border-b border-gray-200 px-3 py-1.5 ${environmentStyles[profile.environment].header}`}>
        <button
          type="button"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="객체 탐색기 토글"
          aria-expanded={sidebarOpen}
          className="rounded border border-gray-300 px-1.5 py-0.5 text-xs text-gray-600 hover:bg-gray-50"
        >
          ☰
        </button>
        <span className="text-sm font-medium">{profile.name}</span>
        <span className={`rounded px-1.5 py-0.5 text-xs ${environmentStyles[profile.environment].badge}`}>
          {profile.environment}
        </span>
        <span className="hidden text-xs text-gray-500 md:inline">
          {profile.username}/{profile.database}
        </span>
        {profile.readOnly && (
          <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">읽기 전용</span>
        )}
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
          TLS {profile.tlsMode}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => void run("replace")}
            disabled={running || !isQueryTab}
            className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
            title={`${displayShortcut(shortcuts.runQuery)} — 현재 결과 교체`}
          >
            ▶ 실행
          </button>
          <button
            type="button"
            onClick={() => void run("new-result")}
            disabled={running || !isQueryTab}
            className="rounded border border-blue-600 px-2 py-1 text-xs text-blue-700 hover:bg-blue-50 disabled:opacity-40"
            title={`${displayShortcut(shortcuts.runQueryNew)} — 새 Result Tab에서 실행`}
          >
            ▶＋
          </button>
          <button
            type="button"
            onClick={() => cancel()}
            disabled={!running}
            className="rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50 disabled:opacity-40"
            title={`${displayShortcut(shortcuts.cancelQuery)} 또는 ${displayShortcut(shortcuts.cancelQueryAlternate)}`}
          >
            ■ 중지
          </button>
          <button
            type="button"
            onClick={() => setHistoryOpen(!historyOpen)}
            aria-pressed={historyOpen}
            className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
            title="쿼리 이력"
          >
            🕘
          </button>
          <button
            type="button"
            onClick={() => void disconnect()}
            disabled={changingDatabase}
            className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
          >
            연결 종료
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {sidebarOpen && <>
          <div style={{ width: sidebarWidth }} className="shrink-0">
            <ObjectSidebar className="w-full" connectionId={connectionId} database={profile.database} changingDatabase={changingDatabase} readOnly={profile.readOnly} onChangeDatabase={(database) => void changeDatabase(database)} onOpenObject={openObject} />
          </div>
          <div
            aria-label="탐색영역 너비 조절"
            aria-orientation="vertical"
            aria-valuemin={180}
            aria-valuemax={480}
            aria-valuenow={sidebarWidth}
            tabIndex={0}
            title="드래그로 탐색영역 너비 조절"
            className="w-1.5 shrink-0 cursor-col-resize touch-none select-none bg-gray-200 hover:bg-blue-300 focus-visible:bg-blue-400 focus-visible:outline-none active:bg-blue-400"
            onPointerDown={(event) => {
              if (event.button !== 0 || event.isPrimary === false) return;
              event.preventDefault();
              event.currentTarget.focus();
              event.currentTarget.setPointerCapture(event.pointerId);
              sidebarResizeStart.current = { pointerId: event.pointerId, x: event.clientX, width: sidebarWidth };
            }}
            onPointerMove={(event) => {
              const start = sidebarResizeStart.current;
              if (!start || start.pointerId !== event.pointerId || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
              setSidebarWidth(Math.max(180, Math.min(480, start.width + event.clientX - start.x)));
            }}
            onPointerUp={() => { sidebarResizeStart.current = null; }}
            onPointerCancel={() => { sidebarResizeStart.current = null; }}
            onLostPointerCapture={() => { sidebarResizeStart.current = null; }}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              setSidebarWidth((width) => event.key === "Home" ? 180 : event.key === "End" ? 480 : Math.max(180, Math.min(480, width + (event.key === "ArrowLeft" ? -16 : 16))));
            }}
          />
        </>}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {notice && <div role="alert" className="bg-amber-50 px-3 py-1 text-xs text-amber-800">{notice}</div>}
      <div className="flex min-h-0 min-w-0 flex-1 divide-x divide-gray-300">
        {groups.map((group, groupIndex) => {
          const tab = state.tabs.find((t) => t.id === group.activeTabId);
          const focused = group.tabIds.includes(state.activeTabId ?? "");
          return (
            <section
              key={group.id}
              aria-label={`쿼리 영역 ${groupIndex + 1}`}
              className="flex min-h-0 min-w-0 flex-1 flex-col"
              onPointerDownCapture={() => { if (tab) dispatch({ type: "TAB_ACTIVATED", tabId: tab.id }); }}
              onFocusCapture={() => { if (tab) dispatch({ type: "TAB_ACTIVATED", tabId: tab.id }); }}
            >
              <div className={`flex shrink-0 items-end border-b ${focused ? "border-blue-400 bg-blue-50" : "border-gray-300 bg-gray-50"}`}>
                <div className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto px-2 pt-1" role="tablist" aria-label={`쿼리 영역 ${groupIndex + 1} 탭`}>
                  {group.tabIds.map((id) => {
                    const item = state.tabs.find((t) => t.id === id)!;
                    return (
                      <div key={id} className={tabBtn(id === group.activeTabId)}>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={id === group.activeTabId}
                          onClick={() => dispatchAndFocusEditor({ type: "TAB_ACTIVATED", tabId: id })}
                          onDoubleClick={() => renameTab(item)}
                          className="max-w-[160px] truncate"
                          title={item.title}
                        >
                          {item.runningExecutionId ? "⏳ " : ""}{item.title}
                        </button>
                        <button type="button" aria-label={`${item.title} 닫기`} onClick={() => void closeQueryTabs([item])} className="rounded px-0.5 text-gray-400 hover:bg-gray-300 hover:text-gray-700">×</button>
                      </div>
                    );
                  })}
                </div>
                <div className="flex shrink-0 items-center py-0.5">
                  <button type="button" aria-label="새 쿼리 탭" title="이 영역에 쿼리 탭 추가" onClick={() => addQueryTab(false, group.id)} className="rounded px-2 text-sm text-gray-500 hover:bg-gray-200">+</button>
                  <button type="button" aria-label="쿼리 영역 좌우 분할" title={`좌우 분할 — ${displayShortcut(shortcuts.splitPanel)}`} onClick={() => addQueryTab(true, group.id)} className="rounded px-2 text-sm text-gray-500 hover:bg-gray-200">◫</button>
                  {groups.length > 1 && (
                    <button type="button" aria-label="분할 영역 닫기" title="이 영역의 탭 모두 닫기" onClick={() => void closeQueryTabs(state.tabs.filter((t) => group.tabIds.includes(t.id)))} className="rounded px-2 text-sm text-gray-500 hover:bg-gray-200">×</button>
                  )}
                </div>
              </div>
              {tab && (
                <div role="region" aria-label={`${tab.title} 작업 영역`} className="flex min-h-0 flex-1 flex-col">
                  <WorkspacePane
                    connectionId={connectionId}
                    database={profile.database}
                    tab={tab}
                    readOnly={profile.readOnly}
                    dispatch={dispatch}
                    onRun={(mode) => void run(mode, tab)}
                    onCancel={() => cancel(tab)}
                    onViewReady={(view) => {
                      if (view) {
                        editorViews.current.set(tab.id, view);
                        if (focusEditor.current === tab.id) {
                          focusEditor.current = null;
                          view.focus();
                        }
                      } else {
                        // StrictMode recreates the focused editor during development.
                        if (editorViews.current.get(tab.id)?.hasFocus && workspaceStates.get(connectionId)?.activeTabId === tab.id) focusEditor.current = tab.id;
                        editorViews.current.delete(tab.id);
                      }
                    }}
                    onCloseResult={(resultTabId) => void closeResultTab(tab, resultTabId)}
                  />
                </div>
              )}
            </section>
          );
        })}
      </div>
        </div>
        {historyOpen && (
          <HistoryPanel
            connectionId={connectionId}
            onClose={() => setHistoryOpen(false)}
            onReopen={(sql) => {
              const tabId = crypto.randomUUID();
              sqlDrafts.set(tabId, sql);
              dispatch({ type: "TAB_ADDED", tabId });
            }}
          />
        )}
      </div>
    </div>
  );
}
