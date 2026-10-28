import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
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
import { TablePropertiesView, type PropertySection } from "./TablePropertiesView";
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
  const resultAreaRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewState>(
    () => tableDataViews.get(tab.id) ?? { sortAttribute: null, sortDescending: false },
  );
  const snapshot = useSyncExternalStore(
    useCallback((cb: () => void) => resultStore.subscribe(resultTabId, cb), [resultTabId]),
    () => resultStore.getSnapshot(resultTabId),
  );
  const running = snapshot.status === "running";
  const [propertySection, setPropertySection] = useState<PropertySection>("columns");

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
      if (editStore.getSnapshot(resultTabId).pendingCount > 0 || resultAreaRef.current?.querySelector('[aria-label="셀 편집"]')) {
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

  const modes = [["properties", "Properties"], ["data", "Data"]] as const;
  const dataMode: TableDataMode = tab.tableDataMode === "properties" ? "properties" : "data";

  return (
      <div ref={resultAreaRef} data-result-area="" className="flex h-full min-h-0 flex-col">
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
      {dataMode === "properties" ? (
        <TablePropertiesView connectionId={connectionId} target={target} meta={meta.data}
          section={propertySection} onSectionChange={setPropertySection} />
      ) : (
        <>
          {editability && (
            <EditBar connectionId={connectionId} resultTabId={resultTabId} editability={editability} />
          )}
          <div className="flex shrink-0 items-center gap-1 border-b border-gray-200 bg-gray-50 px-3 py-1 text-xs">
            <button
              type="button"
              data-refresh-result=""
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
