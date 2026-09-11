import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { editStore } from "../../entities/result/editStore";
import { resultStore } from "../../entities/result/resultStore";
import { tableDataEditability, type Editability } from "../data-editing/editability";
import { EditBar } from "../data-editing/EditBar";
import {
  tableDataViews,
  type QueryTabState,
  type TableDataMode,
  type TableDataView as ViewState,
} from "../../entities/workspace/workspaceStore";
import { ipc } from "../../shared/ipc/invoke";
import { runTableData } from "../../shared/ipc/queryChannel";
import { ResultGrid } from "../result-grid/ResultGrid";

const PAGE_SIZE = 200;

type Props = {
  connectionId: string;
  tab: QueryTabState;
  readOnly: boolean;
  onModeChange: (mode: TableDataMode) => void;
};

export function TableDataView({ connectionId, tab, readOnly, onModeChange }: Props) {
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
      if (!target || resultStore.getSnapshot(resultTabId).status === "running" || editStore.getSnapshot(resultTabId).locked) return;
      if (editStore.getSnapshot(resultTabId).pendingCount > 0) {
        if (!window.confirm("저장하지 않은 변경이 있습니다. 버리고 새로 조회할까요?")) return;
      }
      editStore.clear(resultTabId);
      tableDataViews.set(tab.id, next);
      setView(next);
      try {
        await runTableData({
          connectionId,
          queryTabId: tab.id,
          resultTabId,
          relationOid: target.relationOid,
          sortAttribute: next.sortAttribute,
          sortDescending: next.sortDescending,
          limit: PAGE_SIZE,
          offset: next.offset,
        });
      } catch {
        // The shared execution channel exposes the error in the result status.
      }
    },
    [connectionId, resultTabId, tab.id, target],
  );

  // First open: load page 1.
  useEffect(() => {
    if (snapshot.status === "idle") void fetchPage(view);
  }, [fetchPage, snapshot.status, view]);

  if (!target) return null;

  const editability: Editability | null =
    meta.data && snapshot.status === "completed" && snapshot.columns.length > 0
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
  const dataMode = tab.tableDataMode === "properties" ? "properties" : "data";

  return (
      <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center border-b border-gray-200 bg-gray-50">
        <div className="flex items-center gap-2 px-3 py-1">
          <span className="text-xs font-medium">
            {target.schema}.{target.name}
          </span>
          {meta.data?.rowLevelSecurity && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">RLS</span>
          )}
          <div className="-mb-px ml-1 inline-flex border-b border-gray-200">
            <button
              type="button"
              onClick={() => onModeChange("properties")}
              className={`rounded-t border border-gray-300 px-2.5 py-1 text-xs ${
                dataMode === "properties" ? "border-b-white bg-white font-medium text-gray-900" : "text-gray-600 hover:bg-white/70"
              }`}
            >
              Properties
            </button>
            <button
              type="button"
              onClick={() => onModeChange("data")}
              className={`rounded-t border border-l-0 border-gray-300 px-2.5 py-1 text-xs ${
                dataMode === "data" ? "border-b-white bg-white font-medium text-gray-900" : "text-gray-600 hover:bg-white/70"
              }`}
            >
              Data
            </button>
          </div>
        </div>
      </div>
      {dataMode === "properties" ? (
        <div className="min-h-0 flex-1">
          <div className="flex h-full min-h-0">
            <aside className="w-32 shrink-0 border-r border-gray-200 bg-gray-50 p-2 text-xs">
              <button type="button" className="w-full rounded bg-white px-2 py-1 text-left">
                Columns
              </button>
            </aside>
            <section className="min-h-0 flex-1 overflow-auto">
              <table className="min-w-full table-auto border-separate border-spacing-0 text-xs">
                <thead className="sticky top-0 bg-gray-50">
                  <tr>
                    <th className="border-b border-gray-200 px-2 py-1 text-left font-medium text-gray-600">#</th>
                    <th className="border-b border-gray-200 px-2 py-1 text-left font-medium text-gray-600">column name</th>
                    <th className="border-b border-gray-200 px-2 py-1 text-left font-medium text-gray-600">data type</th>
                    <th className="border-b border-gray-200 px-2 py-1 text-left font-medium text-gray-600">not null</th>
                    <th className="border-b border-gray-200 px-2 py-1 text-left font-medium text-gray-600">default</th>
                    <th className="border-b border-gray-200 px-2 py-1 text-left font-medium text-gray-600">comment</th>
                  </tr>
                </thead>
                <tbody>
                  {meta.data?.columns.map((column) => (
                    <tr key={column.attributeNumber}>
                    <td className="border-b border-gray-100 px-2 py-1">{column.attributeNumber}</td>
                    <td className="border-b border-gray-100 px-2 py-1">{column.name}</td>
                    <td className="border-b border-gray-100 px-2 py-1">{column.pgTypeName}</td>
                    <td className="border-b border-gray-100 px-2 py-1">{column.nullable ? "YES" : "NO"}</td>
                    <td className="border-b border-gray-100 px-2 py-1">{column.defaultExpr ?? "-"}</td>
                    <td className="border-b border-gray-100 px-2 py-1">{column.comment ?? "-"}</td>
                  </tr>
                ))}
                  {!meta.data && (
                    <tr><td className="px-2 py-1 text-gray-500" colSpan={6}>컬럼 정보를 불러오는 중…</td></tr>
                  )}
                  {meta.data?.columns.length === 0 && (
                    <tr><td className="px-2 py-1 text-gray-500" colSpan={6}>컬럼 정보가 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </section>
          </div>
        </div>
      ) : (
        <>
          {editability && (
            <EditBar connectionId={connectionId} resultTabId={resultTabId} editability={editability} />
          )}
          <div className="flex shrink-0 items-center gap-1 border-b border-gray-200 bg-gray-50 px-3 py-1 text-xs">
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
          <div className="min-h-0 flex-1">
            <ResultGrid
              key={`${resultTabId}:${snapshot.executionId ?? "pending"}`}
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
        </>
      )}
    </div>
  );
}
