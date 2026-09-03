import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { editStore, type InsertCell } from "../../entities/result/editStore";
import { resultStore } from "../../entities/result/resultStore";
import type { ColumnMeta, DbValue } from "../../generated/ipc-types";
import { interpretMarker, parseTsv } from "../data-editing/tsv";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function cellText(v: DbValue | undefined): string {
  if (!v) return "";
  switch (v.kind) {
    case "null":
      return "NULL";
    case "boolean":
      return v.value ? "true" : "false";
    case "binary":
      return v.value === null
        ? `<binary ${formatBytes(v.byteLength)}>`
        : `<binary ${formatBytes(v.byteLength)} base64:${v.value.slice(0, 24)}…>`;
    case "array":
      return `{${v.values.map(cellText).join(",")}}`;
    default:
      return v.value;
  }
}

function cellClass(v: DbValue | undefined): string {
  if (!v) return "";
  switch (v.kind) {
    case "null":
      return "text-gray-400 italic";
    case "unknown":
    case "composite":
    case "binary":
      return "text-gray-400";
    case "integer":
    case "decimal":
    case "float":
      return "text-right tabular-nums";
    default:
      return "";
  }
}

type EditProps = {
  /** display column names accepting edits */
  editableColumns: Set<string>;
};

type ResultGridProps = {
  resultTabId: string;
  /** Column names to hide (e.g. the Table Data identity column). */
  hiddenColumns?: string[];
  sort?: { column: string; descending: boolean };
  onHeaderClick?: (columnName: string) => void;
  /** Present only when the result is editable. */
  edit?: EditProps;
};

type EditingCell =
  | { type: "cell"; rowIndex: number; column: string }
  | { type: "insert"; draftId: string; column: string };

function CellEditor({
  initial,
  onCommit,
  onCancel,
  allowDefault,
}: {
  initial: string;
  onCommit: (v: { mode: "value"; value: string } | { mode: "null" } | { mode: "default" }) => void;
  onCancel: () => void;
  allowDefault: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div className="flex items-center gap-1">
      {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit({ mode: "value", value });
          else if (e.key === "Escape") onCancel();
        }}
        onBlur={() => onCommit({ mode: "value", value })}
        className="w-full min-w-0 border border-blue-400 px-1 py-0 text-[13px] outline-none"
        aria-label="셀 편집"
      />
      <button
        type="button"
        title="SQL NULL로 설정"
        onMouseDown={(e) => {
          e.preventDefault();
          onCommit({ mode: "null" });
        }}
        className="shrink-0 rounded border border-gray-300 px-1 text-[10px] text-gray-500 hover:bg-gray-100"
      >
        ∅
      </button>
      {allowDefault && (
        <button
          type="button"
          title="DEFAULT 사용"
          onMouseDown={(e) => {
            e.preventDefault();
            onCommit({ mode: "default" });
          }}
          className="shrink-0 rounded border border-gray-300 px-1 text-[10px] text-gray-500 hover:bg-gray-100"
        >
          D
        </button>
      )}
    </div>
  );
}

// ponytail: header + virtualized rows straight from the ResultStore; adopt the
// TanStack Table column/row model when client sorting/pinning lands.
export function ResultGrid({ resultTabId, hiddenColumns, sort, onHeaderClick, edit }: ResultGridProps) {
  const snapshot = useSyncExternalStore(
    useCallback((cb: () => void) => resultStore.subscribe(resultTabId, cb), [resultTabId]),
    () => resultStore.getSnapshot(resultTabId),
  );
  const edits = useSyncExternalStore(
    useCallback((cb: () => void) => editStore.subscribe(resultTabId, cb), [resultTabId]),
    () => editStore.getSnapshot(resultTabId),
  );
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: snapshot.rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 10,
  });

  const columns = hiddenColumns?.length
    ? snapshot.columns.filter((c) => !hiddenColumns.includes(c.name))
    : snapshot.columns;

  const commitCell = (rowIndex: number, column: ColumnMeta, v: { mode: string; value?: string }) => {
    setEditing(null);
    const original = cellText(snapshot.rows[rowIndex]?.[column.index]);
    if (v.mode === "null") {
      const wasNull = snapshot.rows[rowIndex]?.[column.index]?.kind === "null";
      editStore.setCell(resultTabId, rowIndex, column.name, wasNull ? undefined : { value: null });
    } else if (v.value !== undefined) {
      editStore.setCell(
        resultTabId,
        rowIndex,
        column.name,
        v.value === original ? undefined : { value: v.value },
      );
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    if (!edit) return;
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    const { rows, error } = parseTsv(text);
    if (error || rows.length === 0) return;
    const targets = columns.filter((c) => edit.editableColumns.has(c.name));
    for (const raw of rows) {
      const cells: Record<string, InsertCell> = {};
      raw.slice(0, targets.length).forEach((field, i) => {
        const m = interpretMarker(field);
        cells[targets[i].name] =
          m.mode === "value" ? { mode: "value", value: m.value ?? "" } : { mode: m.mode };
      });
      editStore.addInsert(resultTabId, cells);
    }
  };

  const statusLine = (() => {
    switch (snapshot.status) {
      case "idle":
        return "결과 없음 — 쿼리를 실행하세요 (Cmd+Enter)";
      case "running":
        return `실행 중… ${snapshot.rows.length}행 수신`;
      case "completed":
        return snapshot.commandTag
          ? `${snapshot.commandTag} 완료 · ${snapshot.affectedRows ?? 0}행 영향 · ${snapshot.durationMs}ms`
          : `${snapshot.rowCount}행${snapshot.truncated ? " (행 수 제한 도달)" : ""} · ${snapshot.durationMs}ms`;
      case "failed":
        return `오류: ${snapshot.error?.message ?? "unknown"}${snapshot.error?.sqlState ? ` (SQLSTATE ${snapshot.error.sqlState})` : ""}`;
      case "cancelled":
        return `취소됨 · ${snapshot.rowCount ?? 0}행 수신 · ${snapshot.durationMs}ms`;
    }
  })();

  const renderDataCell = (rowIndex: number, c: ColumnMeta) => {
    const row = snapshot.rows[rowIndex];
    const cell = row[c.index];
    const draft = edit ? edits.updates.get(rowIndex)?.get(c.name) : undefined;
    const editable = Boolean(edit?.editableColumns.has(c.name)) && cell?.kind !== "binary";
    const isEditing =
      editing?.type === "cell" && editing.rowIndex === rowIndex && editing.column === c.name;
    const shown = draft ? (draft.value === null ? "NULL" : draft.value) : cellText(cell);
    return (
      <td
        key={c.index}
        className={`w-[200px] shrink-0 truncate border-b border-r border-gray-100 px-2 py-1 ${
          draft ? "bg-amber-100 font-medium" : cellClass(cell)
        } ${draft?.value === null ? "italic text-gray-500" : ""}`}
        title={shown}
        onDoubleClick={editable ? () => setEditing({ type: "cell", rowIndex, column: c.name }) : undefined}
      >
        {isEditing ? (
          <CellEditor
            initial={draft ? (draft.value ?? "") : cell?.kind === "null" ? "" : cellText(cell)}
            allowDefault={false}
            onCancel={() => setEditing(null)}
            onCommit={(v) => commitCell(rowIndex, c, v)}
          />
        ) : (
          shown
        )}
      </td>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={parentRef}
        onPaste={onPaste}
        className="min-h-0 flex-1 overflow-auto border-t border-gray-200"
        role="grid"
        aria-rowcount={snapshot.rows.length + edits.inserts.length}
      >
        {columns.length > 0 && (
          <table className="border-separate border-spacing-0 text-[13px]">
            <thead className="sticky top-0 z-10">
              <tr role="row">
                <th className="border-b border-r border-gray-200 bg-gray-50 px-2 py-1 text-right font-normal text-gray-400">
                  #
                </th>
                {columns.map((c) => (
                  <th
                    key={c.index}
                    className={`max-w-[320px] truncate border-b border-r border-gray-200 bg-gray-50 px-2 py-1 text-left font-medium ${
                      onHeaderClick ? "cursor-pointer select-none hover:bg-gray-100" : ""
                    }`}
                    title={`${c.name} (${c.pgTypeName.toLowerCase()})`}
                    aria-sort={
                      sort?.column === c.name ? (sort.descending ? "descending" : "ascending") : undefined
                    }
                    onClick={onHeaderClick ? () => onHeaderClick(c.name) : undefined}
                  >
                    {c.name}
                    {sort?.column === c.name && (
                      <span className="ml-0.5 text-blue-600">{sort.descending ? "▼" : "▲"}</span>
                    )}
                    <span className="ml-1 font-normal text-gray-400">{c.pgTypeName.toLowerCase()}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody style={{ height: virtualizer.getTotalSize(), position: "relative", display: "block" }}>
              {virtualizer.getVirtualItems().map((vi) => {
                const deleted = edit ? edits.deletes.has(vi.index) : false;
                return (
                  <tr
                    key={vi.key}
                    role="row"
                    style={{
                      position: "absolute",
                      top: 0,
                      transform: `translateY(${vi.start}px)`,
                      display: "flex",
                      height: vi.size,
                    }}
                    className={deleted ? "bg-red-50 line-through opacity-60" : "hover:bg-blue-50"}
                  >
                    <td className="w-14 shrink-0 border-b border-r border-gray-100 px-1 py-1 text-right text-gray-400">
                      {edit ? (
                        <button
                          type="button"
                          title={deleted ? "삭제 취소" : "행 삭제 표시"}
                          onClick={() => editStore.toggleDelete(resultTabId, vi.index)}
                          className="w-full rounded px-1 text-right hover:bg-red-100 hover:text-red-600"
                        >
                          {vi.index + 1}
                        </button>
                      ) : (
                        vi.index + 1
                      )}
                    </td>
                    {columns.map((c) => renderDataCell(vi.index, c))}
                  </tr>
                );
              })}
            </tbody>
            {edit && (
              <tfoot style={{ display: "block" }}>
                {edits.inserts.map((draft, di) => (
                  <tr key={draft.draftId} role="row" style={{ display: "flex" }} className="bg-green-50">
                    <td className="w-14 shrink-0 border-b border-r border-gray-100 px-1 py-1 text-right">
                      <button
                        type="button"
                        title="새 행 취소"
                        onClick={() => editStore.removeInsert(resultTabId, draft.draftId)}
                        className="w-full rounded px-1 text-right text-green-700 hover:bg-red-100 hover:text-red-600"
                      >
                        +{di + 1}
                      </button>
                    </td>
                    {columns.map((c) => {
                      const cell = draft.cells[c.name];
                      const editable = edit.editableColumns.has(c.name);
                      const isEditing =
                        editing?.type === "insert" &&
                        editing.draftId === draft.draftId &&
                        editing.column === c.name;
                      const shown = !cell || cell.mode === "default" ? "DEFAULT" : cell.mode === "null" ? "NULL" : cell.value;
                      return (
                        <td
                          key={c.index}
                          className={`w-[200px] shrink-0 truncate border-b border-r border-gray-100 px-2 py-1 ${
                            !cell || cell.mode !== "value" ? "italic text-gray-400" : ""
                          }`}
                          onDoubleClick={
                            editable
                              ? () => setEditing({ type: "insert", draftId: draft.draftId, column: c.name })
                              : undefined
                          }
                          title={shown}
                        >
                          {isEditing ? (
                            <CellEditor
                              initial={cell?.mode === "value" ? cell.value : ""}
                              allowDefault
                              onCancel={() => setEditing(null)}
                              onCommit={(v) => {
                                setEditing(null);
                                editStore.setInsertCell(
                                  resultTabId,
                                  draft.draftId,
                                  c.name,
                                  v.mode === "value"
                                    ? { mode: "value", value: v.value ?? "" }
                                    : { mode: v.mode as "null" | "default" },
                                );
                              }}
                            />
                          ) : (
                            shown
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr style={{ display: "flex" }}>
                  <td className="px-2 py-1">
                    <button
                      type="button"
                      onClick={() => editStore.addInsert(resultTabId)}
                      className="rounded border border-dashed border-gray-400 px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100"
                    >
                      ＋ 행 추가 (TSV 붙여넣기 가능)
                    </button>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>
      <div className="shrink-0 border-t border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-600">
        {statusLine}
        {snapshot.transactionState && snapshot.transactionState !== "idle" && (
          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">
            {snapshot.transactionState === "in-transaction" ? "트랜잭션 열림" : "트랜잭션 실패 상태"}
          </span>
        )}
      </div>
    </div>
  );
}
