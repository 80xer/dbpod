import type { EditorView } from "@codemirror/view";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useReducer, useRef, useState } from "react";
import { openConnections } from "../../entities/connection/openConnections";
import { resultStore } from "../../entities/result/resultStore";
import { restoreWorkspace, saveWorkspaceNow, saveWorkspaceSoon } from "../../entities/workspace/persistence";
import {
  emptyWorkspace,
  sqlDrafts,
  workspaceReducer,
  workspaceStates,
  type QueryTabState,
} from "../../entities/workspace/workspaceStore";
import { ObjectSidebar } from "../../features/object-explorer/ObjectSidebar";
import { TableDataView } from "../../features/object-explorer/TableDataView";
import { SqlEditor } from "../../features/query-editor/SqlEditor";
import { statementAt } from "../../features/query-editor/statementSplitter";
import { ResultGrid } from "../../features/result-grid/ResultGrid";
import { ipc } from "../../shared/ipc/invoke";
import { runQuery } from "../../shared/ipc/queryChannel";

const tabBtn = (active: boolean) =>
  `group flex items-center gap-1 rounded-t border-x border-t px-2 py-1 text-xs ${
    active
      ? "border-gray-300 bg-white font-medium"
      : "border-transparent bg-gray-100 text-gray-600 hover:bg-gray-200"
  }`;

export function WorkspacePage() {
  const { connectionId } = useParams({ from: "/workspace/$connectionId" });
  const navigate = useNavigate();
  const profile = openConnections.get(connectionId);

  const [state, dispatch] = useReducer(
    workspaceReducer,
    connectionId,
    (id) =>
      workspaceStates.get(id) ??
      (profile && restoreWorkspace(profile.id)) ??
      emptyWorkspace(),
  );
  useEffect(() => {
    workspaceStates.set(connectionId, state);
    saveWorkspaceSoon();
  }, [connectionId, state]);

  useEffect(() => {
    if (state.tabs.length === 0) dispatch({ type: "TAB_ADDED", tabId: crypto.randomUUID() });
  }, [state.tabs.length]);

  const [notice, setNotice] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const viewRef = useRef<EditorView | null>(null);

  const activeTab = state.tabs.find((t) => t.id === state.activeTabId);
  const running = Boolean(activeTab?.runningExecutionId);

  useEffect(() => {
    if (!profile) void navigate({ to: "/" });
  }, [profile, navigate]);

  // Workspace-level shortcuts: Ctrl+Tab cycling, Cmd/Ctrl+1..9 direct jump.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab" && e.ctrlKey) {
        e.preventDefault();
        dispatch({ type: "TAB_CYCLED", direction: e.shiftKey ? -1 : 1 });
      } else if ((e.metaKey || e.ctrlKey) && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        dispatch({ type: "TAB_ACTIVATED_BY_INDEX", index: Number(e.key) - 1 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!profile) return null;

  const pickSql = (): string | null => {
    const view = viewRef.current;
    if (!view) return null;
    const { from, to } = view.state.selection.main;
    if (from !== to) return view.state.sliceDoc(from, to).trim() || null;
    return statementAt(view.state.doc.toString(), from)?.sql ?? null;
  };

  const run = async (mode: "replace" | "new-result") => {
    const tab = activeTab;
    if (!tab || tab.kind !== "query" || tab.runningExecutionId) return;
    const sql = pickSql();
    if (!sql) {
      setNotice("실행할 SQL이 없습니다.");
      return;
    }
    setNotice("");

    const active = tab.resultTabs.find((r) => r.id === tab.activeResultTabId);
    // Default run replaces the active unprotected result; pinned/running or
    // explicit new-result mode creates a fresh Result Tab on the right.
    const reuse = mode === "replace" && active && !active.isPinned && !active.isRunning;
    const resultTabId = reuse ? active.id : crypto.randomUUID();
    if (!reuse) dispatch({ type: "RESULT_ADDED", tabId: tab.id, resultTabId });

    try {
      const accepted = await runQuery({
        connectionId,
        queryTabId: tab.id,
        resultTabId,
        sql,
        maxRows: profile.maxRows || 500,
        timeoutMs: profile.queryTimeoutMs || 60_000,
      });
      dispatch({
        type: "EXECUTION_STARTED",
        tabId: tab.id,
        resultTabId,
        executionId: accepted.executionId,
        sessionId: accepted.sessionId,
      });
      const unsubscribe = resultStore.subscribe(resultTabId, () => {
        const s = resultStore.getSnapshot(resultTabId);
        if (s.status !== "running" && s.status !== "idle") {
          dispatch({ type: "EXECUTION_ENDED", tabId: tab.id, resultTabId });
          unsubscribe();
        }
      });
    } catch (e) {
      dispatch({ type: "EXECUTION_ENDED", tabId: tab.id, resultTabId });
      const err = e as { message?: string };
      setNotice(err?.message ?? String(e));
    }
  };

  const cancel = () => {
    if (activeTab?.runningExecutionId)
      void ipc.queryCancel({ executionId: activeTab.runningExecutionId });
  };

  const closeResultTab = (tab: QueryTabState, resultTabId: string) => {
    const r = tab.resultTabs.find((x) => x.id === resultTabId);
    if (!r || r.isRunning) return;
    if (r.isPinned && !window.confirm(`고정된 '${r.title}'을(를) 닫을까요?`)) return;
    void ipc.resultRelease({ resultTabId });
    resultStore.dispose(resultTabId);
    dispatch({ type: "RESULT_CLOSED", tabId: tab.id, resultTabId });
  };

  const closeQueryTab = (tab: QueryTabState) => {
    if (tab.runningExecutionId) {
      if (!window.confirm(`'${tab.title}'에 실행 중인 쿼리가 있습니다. 취소하고 닫을까요?`)) return;
      void ipc.queryCancel({ executionId: tab.runningExecutionId });
    }
    if (tab.sessionId)
      void ipc.querySessionClose({ sessionId: tab.sessionId, rollbackOpenTransaction: true });
    for (const r of tab.resultTabs) {
      void ipc.resultRelease({ resultTabId: r.id });
      resultStore.dispose(r.id);
    }
    sqlDrafts.delete(tab.id);
    dispatch({ type: "TAB_CLOSED", tabId: tab.id });
  };

  const disconnect = async () => {
    const hasRunning = state.tabs.some((t) => t.runningExecutionId);
    if (hasRunning && !window.confirm("실행 중인 쿼리가 있습니다. 연결을 종료할까요?")) return;
    for (const tab of state.tabs) {
      for (const r of tab.resultTabs) {
        void ipc.resultRelease({ resultTabId: r.id });
        resultStore.dispose(r.id);
      }
      sqlDrafts.delete(tab.id);
    }
    await saveWorkspaceNow();
    await ipc.connectionClose({ connectionId }).catch(() => undefined);
    openConnections.delete(connectionId);
    workspaceStates.delete(connectionId);
    void navigate({ to: "/" });
  };

  const renameTab = (tab: QueryTabState) => {
    const title = window.prompt("탭 이름", tab.title);
    if (title?.trim()) dispatch({ type: "TAB_RENAMED", tabId: tab.id, title: title.trim() });
  };

  const openTable = (o: { oid: number; schema: string; name: string }) => {
    dispatch({
      type: "TAB_ADDED",
      tabId: crypto.randomUUID(),
      title: o.name,
      tableData: { relationOid: o.oid, schema: o.schema, name: o.name },
    });
  };

  const isQueryTab = activeTab?.kind === "query";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 px-3 py-1.5">
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
        <span className="hidden text-xs text-gray-500 md:inline">
          {profile.username}@{profile.host}/{profile.database}
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
            title="Cmd/Ctrl+Enter — 현재 결과 교체"
          >
            ▶ 실행
          </button>
          <button
            type="button"
            onClick={() => void run("new-result")}
            disabled={running || !isQueryTab}
            className="rounded border border-blue-600 px-2 py-1 text-xs text-blue-700 hover:bg-blue-50 disabled:opacity-40"
            title="Cmd/Ctrl+Shift+Enter — 새 Result Tab에서 실행"
          >
            ▶＋
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={!running}
            className="rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50 disabled:opacity-40"
            title="Esc 또는 Cmd/Ctrl+."
          >
            ■ 중지
          </button>
          <button
            type="button"
            onClick={() => void disconnect()}
            className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
          >
            연결 종료
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {sidebarOpen && <ObjectSidebar connectionId={connectionId} onOpenTable={openTable} />}
        <div className="flex min-w-0 flex-1 flex-col">
      {/* Work Tab bar */}
      <div className="flex shrink-0 items-end gap-1 border-b border-gray-300 bg-gray-50 px-2 pt-1" role="tablist">
        {state.tabs.map((t) => (
          <div key={t.id} className={tabBtn(t.id === state.activeTabId)}>
            <button
              type="button"
              role="tab"
              aria-selected={t.id === state.activeTabId}
              onClick={() => dispatch({ type: "TAB_ACTIVATED", tabId: t.id })}
              onDoubleClick={() => renameTab(t)}
              className="max-w-[160px] truncate"
              title={t.title}
            >
              {t.runningExecutionId ? "⏳ " : ""}
              {t.title}
            </button>
            <button
              type="button"
              aria-label={`${t.title} 닫기`}
              onClick={() => closeQueryTab(t)}
              className="rounded px-0.5 text-gray-400 hover:bg-gray-300 hover:text-gray-700"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          aria-label="새 쿼리 탭"
          onClick={() => dispatch({ type: "TAB_ADDED", tabId: crypto.randomUUID() })}
          className="mb-1 rounded px-2 py-0.5 text-sm text-gray-500 hover:bg-gray-200"
        >
          +
        </button>
      </div>

      {notice && <div className="bg-amber-50 px-3 py-1 text-xs text-amber-800">{notice}</div>}

      {activeTab && activeTab.kind === "table-data" && (
        <TableDataView connectionId={connectionId} tab={activeTab} dispatch={dispatch} />
      )}

      {activeTab && activeTab.kind === "query" && (
        <>
          <div className="min-h-0 flex-1 basis-2/5 overflow-hidden">
            <SqlEditor
              key={activeTab.id}
              initialSql={sqlDrafts.get(activeTab.id) ?? ""}
              onRun={() => void run("replace")}
              onRunNewResult={() => void run("new-result")}
              onCancel={cancel}
              onViewReady={(v) => {
                viewRef.current = v;
              }}
              onDocChanged={(doc) => {
                sqlDrafts.set(activeTab.id, doc);
                saveWorkspaceSoon();
              }}
            />
          </div>

          {/* Result Tab bar */}
          {activeTab.resultTabs.length > 0 && (
            <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-t border-gray-200 bg-gray-50 px-2 py-0.5" role="tablist">
              {activeTab.resultTabs.map((r) => (
                <div
                  key={r.id}
                  className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs ${
                    r.id === activeTab.activeResultTabId
                      ? "bg-white font-medium shadow-sm"
                      : "text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={r.id === activeTab.activeResultTabId}
                    onClick={() =>
                      dispatch({ type: "RESULT_ACTIVATED", tabId: activeTab.id, resultTabId: r.id })
                    }
                  >
                    {r.isRunning ? "⏳ " : ""}
                    {r.title}
                  </button>
                  <button
                    type="button"
                    aria-label={`${r.title} 고정`}
                    title={r.isPinned ? "고정 해제" : "고정 (기본 실행이 덮어쓰지 않음)"}
                    onClick={() =>
                      dispatch({
                        type: "RESULT_PIN_TOGGLED",
                        tabId: activeTab.id,
                        resultTabId: r.id,
                      })
                    }
                    className={r.isPinned ? "text-blue-600" : "text-gray-300 hover:text-gray-500"}
                  >
                    📌
                  </button>
                  <button
                    type="button"
                    aria-label={`${r.title} 닫기`}
                    onClick={() => closeResultTab(activeTab, r.id)}
                    className="rounded px-0.5 text-gray-400 hover:bg-gray-300 hover:text-gray-700"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="min-h-0 flex-1 basis-3/5">
            {activeTab.activeResultTabId ? (
              <ResultGrid resultTabId={activeTab.activeResultTabId} />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-gray-400">
                Cmd/Ctrl+Enter로 쿼리를 실행하세요
              </div>
            )}
          </div>
        </>
      )}
        </div>
      </div>
    </div>
  );
}
