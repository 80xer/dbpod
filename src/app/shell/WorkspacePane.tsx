import type { EditorView } from "@codemirror/view";
import { useId, useRef, useState } from "react";
import { saveWorkspaceSoon } from "../../entities/workspace/persistence";
import { sqlDrafts, type QueryTabState, type WorkspaceAction } from "../../entities/workspace/workspaceStore";
import { TableDataView } from "../../features/object-explorer/TableDataView";
import { RoutineDefinitionView } from "../../features/object-explorer/RoutineDefinitionView";
import { SqlEditor } from "../../features/query-editor/SqlEditor";
import { QueryResultPane } from "../../features/result-grid/QueryResultPane";
import { getAppSettings } from "../../entities/settings/appSettings";
import { displayShortcut } from "../../entities/settings/shortcuts";

type Props = {
  connectionId: string;
  database: string;
  tab: QueryTabState;
  readOnly: boolean;
  dispatch: (action: WorkspaceAction) => void;
  onRun: (mode: "replace" | "new-result") => void;
  onCancel: () => void;
  onViewReady: (view: EditorView | null) => void;
  onCloseResult: (resultTabId: string) => void;
};

export function WorkspacePane({ connectionId, database, tab, readOnly, dispatch, onRun, onCancel, onViewReady, onCloseResult }: Props) {
  const [editorShare, setEditorShare] = useState(40);
  const editorPaneId = useId();
  const queryLayoutRef = useRef<HTMLDivElement>(null);
  const resizeStart = useRef<{ pointerId: number; y: number; share: number; height: number } | null>(null);
  const runShortcut = displayShortcut(getAppSettings().shortcuts.runQuery);

  return <>
      {tab.kind === "routine-definition" && tab.routineOid !== undefined && (
        <RoutineDefinitionView key={tab.id} connectionId={connectionId} routineOid={tab.routineOid} title={tab.title} />
      )}

      {tab.kind === "table-data" && (
        <TableDataView
          key={tab.id}
          connectionId={connectionId}
          tab={tab}
          readOnly={readOnly}
          onModeChange={(mode) => dispatch({ type: "TABLE_DATA_MODE_SET", tabId: tab.id, mode })}
        />
      )}

      {tab.kind === "query" && (
        <div ref={queryLayoutRef} className="flex min-h-0 flex-1 flex-col">
          <div id={editorPaneId} className="min-h-0 overflow-hidden" style={{ flexGrow: editorShare, flexBasis: 0 }}>
            <SqlEditor
              key={tab.id}
              connectionId={connectionId}
              database={database}
              initialSql={sqlDrafts.get(tab.id) ?? ""}
              onRun={() => onRun("replace")}
              onRunNewResult={() => onRun("new-result")}
              onCancel={onCancel}
              onViewReady={onViewReady}
              onDocChanged={(doc) => {
                sqlDrafts.set(tab.id, doc);
                saveWorkspaceSoon();
              }}
            />
          </div>

          <div
            role="separator"
            aria-label="에디터와 Result 영역 높이 조절"
            aria-orientation="horizontal"
            aria-controls={editorPaneId}
            aria-valuemin={20}
            aria-valuemax={80}
            aria-valuenow={Math.round(editorShare)}
            tabIndex={0}
            title="드래그로 높이 조절 · 더블클릭으로 초기화"
            className="h-1.5 shrink-0 cursor-row-resize touch-none select-none bg-gray-200 hover:bg-blue-300 focus-visible:bg-blue-400 focus-visible:outline-none active:bg-blue-400"
            onPointerDown={(event) => {
              if (event.button !== 0 || event.isPrimary === false) return;
              const height = (queryLayoutRef.current?.getBoundingClientRect().height ?? 0) - event.currentTarget.getBoundingClientRect().height;
              if (height <= 0) return;
              event.preventDefault();
              event.currentTarget.focus();
              event.currentTarget.setPointerCapture(event.pointerId);
              resizeStart.current = { pointerId: event.pointerId, y: event.clientY, share: editorShare, height };
            }}
            onPointerMove={(event) => {
              const start = resizeStart.current;
              if (!start || start.pointerId !== event.pointerId || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
              setEditorShare(Math.max(20, Math.min(80, start.share + (event.clientY - start.y) / start.height * 100)));
            }}
            onPointerUp={() => { resizeStart.current = null; }}
            onPointerCancel={() => { resizeStart.current = null; }}
            onLostPointerCapture={() => { resizeStart.current = null; }}
            onDoubleClick={() => setEditorShare(40)}
            onKeyDown={(event) => {
              if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              setEditorShare((share) => event.key === "Home" ? 20 : event.key === "End" ? 80
                : Math.max(20, Math.min(80, share + (event.key === "ArrowUp" ? -5 : 5))));
            }}
          />

          <div className="flex min-h-0 flex-col overflow-hidden" style={{ flexGrow: 100 - editorShare, flexBasis: 0 }}>
          {/* Result Tab bar */}
          {tab.resultTabs.length > 0 && (
            <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-t border-gray-200 bg-gray-50 px-2 py-0.5" role="tablist">
              {tab.resultTabs.map((r) => (
                <div
                  key={r.id}
                  className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs ${
                    r.id === tab.activeResultTabId
                      ? "bg-white font-medium shadow-sm"
                      : "text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={r.id === tab.activeResultTabId}
                    onClick={() =>
                      dispatch({ type: "RESULT_ACTIVATED", tabId: tab.id, resultTabId: r.id })
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
                        tabId: tab.id,
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
                    onClick={() => onCloseResult(r.id)}
                    className="rounded px-0.5 text-gray-400 hover:bg-gray-300 hover:text-gray-700"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="min-h-0 flex-1">
            {tab.activeResultTabId ? (
              <QueryResultPane
                key={tab.activeResultTabId}
                connectionId={connectionId}
                resultTabId={tab.activeResultTabId}
                readOnly={readOnly}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-gray-400">
                {runShortcut}로 쿼리를 실행하세요
              </div>
            )}
          </div>
          </div>
        </div>
      )}
  </>;
}
