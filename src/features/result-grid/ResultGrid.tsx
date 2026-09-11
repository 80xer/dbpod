import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { editStore, type InsertCell } from "../../entities/result/editStore";
import { resultStore } from "../../entities/result/resultStore";
import type { ColumnMeta, DbValue } from "../../generated/ipc-types";
import { ipc } from "../../shared/ipc/invoke";
import { loadMoreRows } from "../../shared/ipc/queryChannel";
import { interpretMarker, parseTsv } from "../data-editing/tsv";
import { cellClass, cellText } from "./cellText";
import { toCsv, toJson, toTsv } from "./exporters";
import { getAppSettings } from "../../entities/settings/appSettings";
import { shortcutMatches } from "../../entities/settings/shortcuts";

export { cellText } from "./cellText";

type CellPos = { r: number; c: number };
type Selection = { anchor: CellPos; focus: CellPos };

function selectionRange(sel: Selection) {
  return {
    minR: Math.min(sel.anchor.r, sel.focus.r),
    maxR: Math.max(sel.anchor.r, sel.focus.r),
    minC: Math.min(sel.anchor.c, sel.focus.c),
    maxC: Math.max(sel.anchor.c, sel.focus.c),
  };
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
  const finished = useRef(false);
  const commit: typeof onCommit = (v) => { if (!finished.current) { finished.current = true; onCommit(v); } };
  const cancel = () => { finished.current = true; onCancel(); };
  return (
    <div className="flex items-center gap-1" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) commit({ mode: "value", value }); }}>
      {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit({ mode: "value", value });
          else if (e.key === "Escape") cancel();
        }}
        className="w-full min-w-0 border border-blue-400 px-1 py-0 text-[13px] outline-none"
        aria-label="셀 편집"
      />
      <button
        type="button"
        title="SQL NULL로 설정"
        aria-label="SQL NULL로 설정"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => commit({ mode: "null" })}
        className="shrink-0 rounded border border-gray-300 px-1 text-[10px] text-gray-500 hover:bg-gray-100"
      >
        ∅
      </button>
      {allowDefault && (
        <button
          type="button"
          title="DEFAULT 사용"
          aria-label="DEFAULT 사용"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => commit({ mode: "default" })}
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
  const [message, setMessage] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  const previousRowCount = useRef(snapshot.rows.length);
  useEffect(() => {
    const previous = previousRowCount.current;
    previousRowCount.current = snapshot.rows.length;
    const delta = snapshot.rows.length - previous;
    setSelection((selected) => {
      if (!selected || delta < 0) return null;
      const rebase = (position: CellPos) => ({ ...position, r: position.r >= previous ? position.r + delta : position.r });
      const next = { anchor: rebase(selected.anchor), focus: rebase(selected.focus) };
      if (Math.max(next.anchor.r, next.focus.r) >= snapshot.rows.length + edits.inserts.length) return null;
      return delta ? next : selected;
    });
  }, [snapshot.rows.length, edits.inserts.length]);
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: snapshot.rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 10,
  });
  const loadNearEnd = useCallback(() => {
    const element = parentRef.current;
    const current = resultStore.getSnapshot(resultTabId);
    if (element && element.clientHeight > 0 && element.scrollHeight - element.scrollTop - element.clientHeight < 28 * 20
      && current.hasMoreRows && !current.loadingMore && !current.pageError) void loadMoreRows(resultTabId);
  }, [resultTabId]);
  useEffect(loadNearEnd, [loadNearEnd, snapshot.rows.length, snapshot.hasMoreRows]);

  const columns = hiddenColumns?.length
    ? snapshot.columns.filter((c) => !hiddenColumns.includes(c.name))
    : snapshot.columns;
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const resizingColumn = useRef<{ name: string; startX: number; startWidth: number } | null>(null);
  const DEFAULT_COLUMN_WIDTH = 200;
  const MIN_COLUMN_WIDTH = 60;

  useEffect(() => {
    if (!columns.length) return;
    setColumnWidths((current) => {
      const next = { ...current };
      for (const column of columns) if (next[column.name] == null) next[column.name] = DEFAULT_COLUMN_WIDTH;
      return next;
    });
  }, [columns]);

  const getColumnWidth = (name: string) => columnWidths[name] ?? DEFAULT_COLUMN_WIDTH;
  const onColumnResizeStart = (name: string, event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const columnName = name;
    const startWidth = getColumnWidth(columnName);
    const startX = event.clientX;
    resizingColumn.current = { name: columnName, startX, startWidth };
    const move = (next: PointerEvent) => {
      if (!resizingColumn.current) return;
      const delta = next.clientX - resizingColumn.current.startX;
      const width = Math.max(MIN_COLUMN_WIDTH, Math.round(resizingColumn.current.startWidth + delta));
      setColumnWidths((current) => ({ ...current, [columnName]: width }));
    };
    const stop = () => {
      resizingColumn.current = null;
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", stop);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", stop);
  };

  const selectRow = (rowIndex: number, extend = false) => {
    if (!columns.length) return;
    setSelection((previous) => ({
      anchor: { r: extend && previous ? previous.anchor.r : rowIndex, c: 0 },
      focus: { r: rowIndex, c: columns.length - 1 },
    }));
    parentRef.current?.focus({ preventScroll: true });
  };

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

  const allResultRows = async () => {
    const rows = [...snapshot.rows];
    if (!snapshot.hasMoreRows || !snapshot.executionId) return rows;
    let offset = snapshot.nextRowOffset ?? 0;
    for (;;) {
      const page = await ipc.resultRowsFetch({ resultTabId, executionId: snapshot.executionId, offset });
      if (page.nextOffset !== offset + page.rows.length || (page.hasMore && !page.rows.length)) throw new Error("결과 페이지의 행 순서가 올바르지 않습니다.");
      rows.push(...page.rows);
      if (!page.hasMore) return rows;
      offset = page.nextOffset;
    }
  };

  const copySelection = async () => {
    const range = selection ? selectionRange(selection) : null;
    const cols = range ? columns.slice(range.minC, range.maxC + 1) : columns;
    // Clipboard writes happen only on this explicit user gesture.
    try {
      const rows = range ? Array.from({ length: range.maxR - range.minR + 1 }, (_, i) => {
        const r = range.minR + i;
        if (r < snapshot.rows.length) return snapshot.rows[r];
        const draft = edits.inserts[r - snapshot.rows.length];
        return snapshot.columns.map((c): DbValue => {
          const cell = draft?.cells[c.name];
          return cell?.mode === "null" ? { kind: "null" } : { kind: "text", value: cell?.mode === "value" ? cell.value ?? "" : "DEFAULT" };
        });
      }) : await allResultRows();
      if (!rows.length) return;
      await navigator.clipboard.writeText(toTsv(cols, rows, !range)); setMessage("");
    }
    catch (error) { setMessage((error as Error).message ?? String(error)); }
  };

  const exportAs = async (format: "csv" | "json") => {
    try {
      const rows = await allResultRows();
      const content = format === "csv" ? toCsv(columns, rows) : toJson(columns, rows);
      await ipc.exportSave({ suggestedName: `dbpod-result.${format}`, content });
      setMessage("");
    } catch (error) { setMessage((error as Error).message ?? String(error)); }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing) return;
    const shortcuts = getAppSettings().shortcuts;
    if (shortcutMatches(e, shortcuts.copyGrid)) {
      e.preventDefault();
      void copySelection();
      return;
    }
    if (!columns.length || snapshot.rows.length + edits.inserts.length === 0) return;
    const position = selection?.focus ?? { r: 0, c: 0 };
    if (selection && shortcutMatches(e, shortcuts.selectGridRow)) {
      e.preventDefault();
      selectRow(position.r);
      return;
    }
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      const next = { ...position };
      if (e.key === "ArrowUp") next.r--;
      if (e.key === "ArrowDown") next.r++;
      if (e.key === "ArrowLeft") next.c--;
      if (e.key === "ArrowRight") next.c++;
      if (e.key === "Home") { next.c = 0; if (e.ctrlKey || e.metaKey) next.r = 0; }
      if (e.key === "End") { next.c = columns.length - 1; if (e.ctrlKey || e.metaKey) next.r = snapshot.rows.length + edits.inserts.length - 1; }
      next.r = Math.max(0, Math.min(snapshot.rows.length + edits.inserts.length - 1, next.r));
      next.c = Math.max(0, Math.min(columns.length - 1, next.c));
      setSelection({ anchor: e.shiftKey && selection ? selection.anchor : next, focus: next });
      if (next.r < snapshot.rows.length) virtualizer.scrollToIndex(next.r, { align: "auto" });
      parentRef.current?.querySelector(`[data-cell="${next.r}:${next.c}"]`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    } else if ((e.key === "F2" || e.key === "Enter") && edit?.editableColumns.has(columns[position.c].name) && !edits.locked) {
      e.preventDefault();
      const draft = edits.inserts[position.r - snapshot.rows.length];
      setEditing(draft ? { type: "insert", draftId: draft.draftId, column: columns[position.c].name }
        : { type: "cell", rowIndex: position.r, column: columns[position.c].name });
    } else if (e.key === "Escape") setSelection(null);
  };

  const selectedRange = selection ? selectionRange(selection) : null;
  const fullRowsSelected = Boolean(selectedRange && selectedRange.minC === 0 && selectedRange.maxC === columns.length - 1);
  const allSelectedDeleted = fullRowsSelected && selectedRange!.maxR < snapshot.rows.length
    && Array.from({ length: selectedRange!.maxR - selectedRange!.minR + 1 }, (_, i) => selectedRange!.minR + i).every((r) => edits.deletes.has(r));
  const deleteSelectedRows = () => {
    if (!edit || edits.locked || !fullRowsSelected || !selectedRange) return;
    for (let r = selectedRange.minR; r <= selectedRange.maxR; r++) {
      const draft = edits.inserts[r - snapshot.rows.length];
      if (draft) editStore.removeInsert(resultTabId, draft.draftId);
      else if (r < snapshot.rows.length && edits.deletes.has(r) === Boolean(allSelectedDeleted)) editStore.toggleDelete(resultTabId, r);
    }
  };
  const inSelection = (r: number, ci: number) =>
    Boolean(
      selectedRange &&
        r >= selectedRange.minR &&
        r <= selectedRange.maxR &&
        ci >= selectedRange.minC &&
        ci <= selectedRange.maxC,
    );

  const onPaste = (e: React.ClipboardEvent) => {
    if (!edit || editing || edits.locked) return;
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    const { rows, quoted, error } = parseTsv(text);
    if (error) { setMessage(error); return; }
    if (rows.length === 0) return;
    const targets = columns.filter((c) => edit.editableColumns.has(c.name));
    if (targets.length === 0 || rows.some((row) => row.length > targets.length)) {
      setMessage("붙여넣기 열 수가 편집 가능한 열 수를 초과합니다. 열을 맞춘 후 다시 붙여넣으세요.");
      return;
    }
    if (edits.inserts.length + rows.length > 500) { setMessage("저장 대기 중인 새 행은 최대 500개입니다."); return; }
    setMessage("");
    for (const [rowIndex, raw] of rows.entries()) {
      const cells: Record<string, InsertCell> = {};
      raw.forEach((field, i) => {
        const m = interpretMarker(field, quoted[rowIndex]?.[i]);
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
          : `${snapshot.rows.length}행 표시${snapshot.hasMoreRows ? ` / ${snapshot.rowCount}행 · 아래로 스크롤하여 추가 조회` : ""}${snapshot.truncated ? (snapshot.pageable ? " (메모리 보호 한도 도달)" : " (행 수 또는 메모리 제한 도달)") : ""} · ${snapshot.durationMs}ms`;
      case "failed":
        return `오류: ${snapshot.error?.message ?? "unknown"}${snapshot.error?.sqlState ? ` (SQLSTATE ${snapshot.error.sqlState})` : ""}`;
      case "cancelled":
        return `취소됨 · ${snapshot.rowCount ?? 0}행 수신 · ${snapshot.durationMs}ms`;
    }
  })();

  const renderDataCell = (rowIndex: number, c: ColumnMeta, ci: number) => {
    const row = snapshot.rows[rowIndex];
    const cell = row[c.index];
    const draft = edit ? edits.updates.get(rowIndex)?.get(c.name) : undefined;
    const editable = Boolean(edit?.editableColumns.has(c.name)) && cell?.kind !== "binary" && !edits.locked;
    const isEditing =
      editing?.type === "cell" && editing.rowIndex === rowIndex && editing.column === c.name;
    const shown = draft ? (draft.value === null ? "NULL" : draft.value) : cellText(cell);
    const selected = inSelection(rowIndex, ci);
    return (
      <td
        key={c.index}
        role="gridcell"
        aria-selected={selected}
        data-cell={`${rowIndex}:${ci}`}
        style={{
          width: `${getColumnWidth(c.name)}px`,
          minWidth: `${getColumnWidth(c.name)}px`,
          maxWidth: `${getColumnWidth(c.name)}px`,
          flex: `0 0 ${getColumnWidth(c.name)}px`,
        }}
        className={`shrink-0 select-none truncate border-b border-r border-gray-100 px-2 py-1 ${
          draft ? "bg-amber-100 font-medium" : cellClass(cell)
        } ${draft?.value === null ? "italic text-gray-500" : ""} ${
          selected ? "bg-blue-200/70" : ""
        }`}
        title={shown}
        onMouseDown={(e) => {
          if (e.button !== 0 || isEditing) return;
          e.preventDefault();
          parentRef.current?.focus({ preventScroll: true });
          const pos = { r: rowIndex, c: ci };
          setSelection((prev) =>
            e.shiftKey && prev ? { anchor: prev.anchor, focus: pos } : { anchor: pos, focus: pos },
          );
        }}
        onMouseEnter={(e) => {
          if (e.buttons === 1 && !editing)
            setSelection((prev) => (prev ? { anchor: prev.anchor, focus: { r: rowIndex, c: ci } } : prev));
        }}
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
      {message && <p role="alert" className="bg-amber-50 px-3 py-1 text-xs text-amber-800">{message}</p>}
      <div
        ref={parentRef}
        onScroll={loadNearEnd}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-auto border-t border-gray-200 outline-none focus-visible:ring-1 focus-visible:ring-blue-300"
        role="grid"
        aria-label="쿼리 결과"
        aria-rowcount={snapshot.rows.length + edits.inserts.length}
        aria-colcount={columns.length}
        aria-busy={snapshot.status === "running" || snapshot.loadingMore}
      >
        {columns.length > 0 && (
          <table className="border-separate border-spacing-0 text-[13px]">
            <thead className="sticky top-0 z-10">
              <tr role="row" style={{ display: "flex" }}>
                <th className="w-14 shrink-0 border-b border-r border-gray-200 bg-gray-50 px-2 py-1 text-right font-normal text-gray-400">
                  #
                </th>
                {columns.map((c) => (
                  <th
                    key={c.index}
                    className={`relative shrink-0 truncate border-b border-r border-gray-200 bg-gray-50 px-2 py-1 text-left font-medium ${
                      onHeaderClick ? "cursor-pointer select-none hover:bg-gray-100" : ""
                    }`}
                    style={{
                      width: `${getColumnWidth(c.name)}px`,
                      minWidth: `${getColumnWidth(c.name)}px`,
                      maxWidth: `${getColumnWidth(c.name)}px`,
                      flex: `0 0 ${getColumnWidth(c.name)}px`,
                    }}
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
                    <span
                      role="presentation"
                      aria-hidden="true"
                      className="absolute right-0 top-0 h-full w-2 -translate-x-0.5 cursor-col-resize touch-none"
                      onPointerDown={(event) => onColumnResizeStart(c.name, event)}
                    />
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
                    aria-selected={fullRowsSelected && inSelection(vi.index, 0)}
                    style={{
                      position: "absolute",
                      top: 0,
                      transform: `translateY(${vi.start}px)`,
                      display: "flex",
                      height: vi.size,
                    }}
                    className={deleted ? "bg-red-50 line-through opacity-60" : "hover:bg-blue-50"}
                  >
                    <td role="rowheader" onClick={(event) => selectRow(vi.index, event.shiftKey)} className={`w-14 shrink-0 cursor-pointer border-b border-r border-gray-100 px-1 py-1 text-right ${fullRowsSelected && inSelection(vi.index, 0) ? "bg-blue-200 text-blue-800" : "text-gray-400"}`}>
                        <button
                          type="button"
                          title={`${vi.index + 1}행 선택`}
                          aria-label={`${vi.index + 1}행 선택`}
                          className="w-full rounded px-1 text-right hover:bg-blue-100 hover:text-blue-700"
                        >
                          {vi.index + 1}
                        </button>
                    </td>
                    {columns.map((c, ci) => renderDataCell(vi.index, c, ci))}
                  </tr>
                );
              })}
            </tbody>
            {edit && (
              <tfoot style={{ display: "block" }}>
                {edits.inserts.map((draft, di) => (
                  <tr key={draft.draftId} role="row" aria-selected={fullRowsSelected && inSelection(snapshot.rows.length + di, 0)} style={{ display: "flex" }} className="bg-green-50">
                    <td role="rowheader" onClick={(event) => selectRow(snapshot.rows.length + di, event.shiftKey)} className="w-14 shrink-0 cursor-pointer border-b border-r border-gray-100 px-1 py-1 text-right">
                      <button
                        type="button"
                        title={`새 ${di + 1}행 선택`}
                        aria-label={`새 ${di + 1}행 선택`}
                        className="w-full rounded px-1 text-right text-green-700 hover:bg-blue-100 hover:text-blue-700"
                      >
                        +{di + 1}
                      </button>
                    </td>
                    {columns.map((c, ci) => {
                      const cell = draft.cells[c.name];
                      const editable = edit.editableColumns.has(c.name) && !edits.locked;
                      const isEditing =
                        editing?.type === "insert" &&
                        editing.draftId === draft.draftId &&
                        editing.column === c.name;
                      const shown = !cell || cell.mode === "default" ? "DEFAULT" : cell.mode === "null" ? "NULL" : cell.value;
                      return (
                        <td
                          key={c.index}
                          role="gridcell"
                          aria-selected={inSelection(snapshot.rows.length + di, ci)}
                          data-cell={`${snapshot.rows.length + di}:${ci}`}
                          style={{
                            width: `${getColumnWidth(c.name)}px`,
                            minWidth: `${getColumnWidth(c.name)}px`,
                            maxWidth: `${getColumnWidth(c.name)}px`,
                            flex: `0 0 ${getColumnWidth(c.name)}px`,
                          }}
                          className={`shrink-0 truncate border-b border-r border-gray-100 px-2 py-1 ${
                            !cell || cell.mode !== "value" ? "italic text-gray-400" : ""
                          } ${inSelection(snapshot.rows.length + di, ci) ? "bg-blue-200/70" : ""}`}
                          onMouseDown={(event) => {
                            if (event.button !== 0 || isEditing) return;
                            event.preventDefault();
                            parentRef.current?.focus({ preventScroll: true });
                            const position = { r: snapshot.rows.length + di, c: ci };
                            setSelection({ anchor: position, focus: position });
                          }}
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
                      disabled={edits.locked || edits.inserts.length >= 500}
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
      <div className="flex shrink-0 items-center border-t border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-600">
        <span>{statusLine}</span>
        {snapshot.loadingMore && <span role="status" className="ml-2">다음 200행 불러오는 중…</span>}
        {snapshot.pageError && <span role="alert" className="ml-2 text-red-600">{snapshot.pageError} <button type="button" className="underline" onClick={() => void loadMoreRows(resultTabId)}>다시 시도</button></span>}
        {edit && <button type="button" disabled={!fullRowsSelected || edits.locked} onClick={deleteSelectedRows}
          className="ml-2 rounded border border-red-200 px-1.5 py-0.5 text-red-600 hover:bg-red-50 disabled:opacity-40">
          {allSelectedDeleted ? "선택 행 삭제 취소" : "선택 행 삭제"}
        </button>}
        {snapshot.transactionState && snapshot.transactionState !== "idle" && (
          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">
            {snapshot.transactionState === "in-transaction" ? "트랜잭션 열림" : "트랜잭션 실패 상태"}
          </span>
        )}
        {snapshot.rows.length > 0 && (
          <span className="ml-auto flex gap-1.5">
            <button
              type="button"
              onClick={copySelection}
              title="선택 영역(없으면 전체)을 TSV로 복사 (Cmd/Ctrl+C)"
              className="rounded border border-gray-300 px-1.5 py-0.5 hover:bg-gray-100"
            >
              TSV 복사
            </button>
            <button
              type="button"
              onClick={() => void exportAs("csv")}
              title="CSV 내보내기 (formula injection 방어 적용)"
              className="rounded border border-gray-300 px-1.5 py-0.5 hover:bg-gray-100"
            >
              CSV
            </button>
            <button
              type="button"
              onClick={() => void exportAs("json")}
              className="rounded border border-gray-300 px-1.5 py-0.5 hover:bg-gray-100"
            >
              JSON
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
