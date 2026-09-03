import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { editStore } from "../../entities/result/editStore";
import { resultStore } from "../../entities/result/resultStore";
import { tableDataEditability, type Editability } from "../data-editing/editability";
import { EditBar } from "../data-editing/EditBar";
import {
  tableDataViews,
  type QueryTabState,
  type TableDataView as ViewState,
  type WorkspaceAction,
} from "../../entities/workspace/workspaceStore";
import { ipc } from "../../shared/ipc/invoke";
import { runTableData } from "../../shared/ipc/queryChannel";
import { ResultGrid } from "../result-grid/ResultGrid";

const PAGE_SIZE = 200;

type Props = {
  connectionId: string;
  tab: QueryTabState;
  dispatch: (a: WorkspaceAction) => void;
  readOnly: boolean;
};

export function TableDataView({ connectionId, tab, dispatch, readOnly }: Props) {
  const target = tab.tableData;
  const resultTabId = `${tab.id}:data`;
  const [view, setView] = useState<ViewState>(
    () => tableDataViews.get(tab.id) ?? { offset: 0, sortAttribute: null, sortDescending: false },
  );
  const snapshot = useSyncExternalStore(
    useCallback((cb: () => void) => resultStore.subscribe(resultTabId, cb), [resultTabId]),
    () => resultStore.getSnapshot(resultTabId),
  );
  const running = snapshot.status === "running";

  const meta = useQuery({
    queryKey: ["table", connectionId, target?.relationOid],
    queryFn: () =>
      ipc.metadataGetTable({ connectionId, relationOid: target?.relationOid ?? 0 }),
    enabled: Boolean(target),
    staleTime: 60_000,
  });

  const fetchPage = useCallback(
    async (next: ViewState) => {
      if (!target) return;
      if (editStore.getSnapshot(resultTabId).pendingCount > 0) {
        if (!window.confirm("저장하지 않은 변경이 있습니다. 버리고 새로 조회할까요?")) return;
      }
      editStore.clear(resultTabId);
      tableDataViews.set(tab.id, next);
      setView(next);
      try {
        const accepted = await runTableData({
          connectionId,
          queryTabId: tab.id,
          resultTabId,
          relationOid: target.relationOid,
          sortAttribute: next.sortAttribute,
          sortDescending: next.sortDescending,
          limit: PAGE_SIZE,
          offset: next.offset,
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
      } catch {
        dispatch({ type: "EXECUTION_ENDED", tabId: tab.id, resultTabId });
      }
    },
    [connectionId, dispatch, resultTabId, tab.id, target],
  );

  // First open: load page 1.
  useEffect(() => {
    if (snapshot.status === "idle") void fetchPage(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!target) return null;

  const editability: Editability | null =
    meta.data && snapshot.columns.length > 0
      ? tableDataEditability(snapshot.columns, meta.data, readOnly)
      : null;

  const sortColumnName = meta.data?.columns.find(
    (c) => c.attributeNumber === view.sortAttribute,
  )?.name;

  const onHeaderClick = (columnName: string) => {
    if (running) return;
    const col = meta.data?.columns.find((c) => c.name === columnName);
    if (!col) return;
    const next: ViewState =
      view.sortAttribute === col.attributeNumber && !view.sortDescending
        ? { ...view, sortDescending: true, offset: 0 }
        : { offset: 0, sortAttribute: col.attributeNumber, sortDescending: false };
    void fetchPage(next);
  };

  const pageStart = view.offset + 1;
  const pageEnd = view.offset + snapshot.rows.length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 bg-gray-50 px-3 py-1">
        <span className="text-xs font-medium">
          {target.schema}.{target.name}
        </span>
        {meta.data?.rowLevelSecurity && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">RLS</span>
        )}
        <div className="ml-auto flex items-center gap-1 text-xs">
          <button
            type="button"
            onClick={() => void fetchPage({ ...view, offset: Math.max(0, view.offset - PAGE_SIZE) })}
            disabled={running || view.offset === 0}
            className="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-100 disabled:opacity-40"
            aria-label="이전 페이지"
          >
            ‹
          </button>
          <span className="tabular-nums text-gray-600">
            {snapshot.rows.length > 0 ? `${pageStart}–${pageEnd}` : "0"}행
          </span>
          <button
            type="button"
            onClick={() => void fetchPage({ ...view, offset: view.offset + PAGE_SIZE })}
            disabled={running || snapshot.rows.length < PAGE_SIZE}
            className="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-100 disabled:opacity-40"
            aria-label="다음 페이지"
          >
            ›
          </button>
          <button
            type="button"
            onClick={() => void fetchPage(view)}
            disabled={running}
            className="ml-1 rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-100 disabled:opacity-40"
          >
            새로고침
          </button>
        </div>
      </div>
      {editability && (
        <EditBar connectionId={connectionId} resultTabId={resultTabId} editability={editability} />
      )}
      <div className="min-h-0 flex-1">
        <ResultGrid
          resultTabId={resultTabId}
          hiddenColumns={["__dbpod_xmin"]}
          sort={
            sortColumnName ? { column: sortColumnName, descending: view.sortDescending } : undefined
          }
          onHeaderClick={onHeaderClick}
          edit={
            editability?.editable
              ? { editableColumns: editability.editableColumns }
              : undefined
          }
        />
      </div>
    </div>
  );
}
