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
import { DefinitionView } from "./DefinitionView";
import { runTableData } from "../../shared/ipc/queryChannel";
import { ResultGrid } from "../result-grid/ResultGrid";
import { confirmDialog } from "../../shared/ui/prompt";

const PAGE_SIZE = 200;

type Props = {
  connectionId: string;
  tab: QueryTabState;
  readOnly: boolean;
  /** The panel holding this tab has the keyboard; colours the selected mode like a query tab. */
  focused: boolean;
  onModeChange: (mode: TableDataMode) => void;
};

export function TableDataView({ connectionId, tab, readOnly, focused, onModeChange }: Props) {
  const target = tab.tableData;
  const resultTabId = `${tab.id}:data`;
  const [view, setView] = useState<ViewState>(
    () => tableDataViews.get(tab.id) ?? { sortAttribute: null, sortDescending: false },
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
        if (!(await confirmDialog("저장하지 않은 변경이 있습니다. 버리고 새로 조회할까요?"))) return;
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
          offset: 0,
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
        ? { ...view, sortDescending: true }
        : { sortAttribute: col.attributeNumber, sortDescending: false };
    void fetchPage(next);
  };

  const isView = meta.data?.kind === "view" || meta.data?.kind === "materialized-view";
  const modes = ([["properties", "Properties"], ["data", "Data"], ["script", "Script"]] as const)
    .filter(([mode]) => mode !== "script" || isView);
  const dataMode: TableDataMode = tab.tableDataMode === "properties" || (tab.tableDataMode === "script" && isView) ? tab.tableDataMode : "data";

  return (
      <div data-result-area="" className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center border-b border-gray-200 bg-gray-50">
        <div className="flex items-center gap-2 px-3 py-1">
          <span className="text-xs font-medium">
            {target.schema}.{target.name}
          </span>
          {meta.data?.rowLevelSecurity && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">RLS</span>
          )}
          <div className="-mb-px ml-1 inline-flex items-end gap-1">
            {modes.map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => onModeChange(mode)}
                className={`rounded-t border-x border-t px-2.5 py-1 text-xs ${
                  dataMode === mode
                    ? `bg-white font-medium text-gray-900 ${focused ? "border-blue-400" : "border-gray-300"}`
                    : "border-transparent bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {dataMode === "script" ? (
        <DefinitionView title={`${target.schema}.${target.name}`} queryKey={["view-definition", connectionId, target.relationOid]}
          load={() => ipc.metadataGetViewDefinition({ connectionId, relationOid: target.relationOid })} />
      ) : dataMode === "properties" ? (
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
