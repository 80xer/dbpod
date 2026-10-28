// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ResultGrid } from "./ResultGrid";
import { resultStore } from "../../entities/result/resultStore";
import { editStore } from "../../entities/result/editStore";
import { ipc } from "../../shared/ipc/invoke";
import type { DbValue, ResultRowsFetchResponse, TableMetadata } from "../../generated/ipc-types";
import { tableDataEditability } from "../data-editing/editability";
import { buildRowChanges } from "../data-editing/saveChanges";
vi.mock("@tanstack/react-virtual", () => ({ useVirtualizer: ({ count }: { count: number }) => ({ getTotalSize: () => count * 28, scrollToIndex: vi.fn(), getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 28, size: 28 })) }) }));
vi.mock("../../shared/ipc/invoke", () => ({ ipc: { exportSave: vi.fn(), resultRowsFetch: vi.fn(), tableDataFetchPage: vi.fn() } }));
beforeEach(() => {
  vi.clearAllMocks();
  resultStore.dispose("grid"); resultStore.create("grid");
  resultStore.setColumns("grid", ["id", "name"].map((name, index) => ({ name, index, pgTypeOid: 25, pgTypeName: "text", category: "text", source: null, nullable: true, editable: false })));
  resultStore.pushRows("grid", [[{ kind: "text", value: "1" }, { kind: "text", value: "Alpha" }], [{ kind: "text", value: "2" }, { kind: "text", value: "Beta" }]]);
  resultStore.setTerminal("grid", { status: "completed" });
  render(<ResultGrid resultTabId="grid" edit={{ editableColumns: new Set(["name"]) }} />);
});
afterEach(cleanup);
test("shows detailed execution errors alongside the footer and clears them on rerun", () => {
  const error = {
    code: "POSTGRES_ERROR", message: 'column "missing" does not exist', retryable: false,
    sqlState: "42703", position: 8, detail: "First line\nSecond line", hint: 'Perhaps you meant "name".',
  };
  act(() => { resultStore.setTerminal("grid", { status: "failed", error }); });
  const details = within(screen.getByRole("alert", { name: "쿼리 실행 오류" }));
  for (const value of [error.message, error.sqlState, error.code, error.hint, "8번째 문자"])
    expect(details.getByText(value)).toBeTruthy();
  expect(details.getByText(/First line/).textContent).toBe(error.detail);
  expect(screen.getByText(`오류: ${error.message} (SQLSTATE 42703)`)).toBeTruthy();
  expect(within(screen.getByRole("grid")).getByText("Alpha")).toBeTruthy();

  act(() => { resultStore.create("grid", "SELECT 1"); });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByText(/오류:/)).toBeNull();
  act(() => { resultStore.setTerminal("grid", { status: "failed", error: {
    ...error, code: "CONNECTION_LOST", message: "database connection lost", sqlState: null,
    position: null, detail: null, hint: null,
  } }); });
  expect(within(screen.getByRole("alert")).getByText("database connection lost")).toBeTruthy();
  for (const label of ["SQLSTATE", "상세 정보", "힌트", "오류 위치"])
    expect(screen.queryByText(label)).toBeNull();
  expect(screen.queryByRole("grid")).toBeNull();
});

test("keyboard navigation edits the focused cell and Escape discards the active editor", () => {
  const grid = screen.getByRole("grid");
  fireEvent.keyDown(grid, { key: "ArrowDown" }); fireEvent.keyDown(grid, { key: "ArrowRight" }); fireEvent.keyDown(grid, { key: "Enter" });
  const input = screen.getByLabelText("셀 편집"); expect((input as HTMLInputElement).value).toBe("Beta");
  fireEvent.change(input, { target: { value: "changed" } }); fireEvent.keyDown(input, { key: "Escape" });
  expect(editStore.getSnapshot("grid").pendingCount).toBe(0);
  // Closing the editor unmounts the focused input; the grid has to take focus back,
  // or keys aimed at the result (save, refresh, navigation) land on the body instead.
  expect(document.activeElement).toBe(grid);
  fireEvent.keyDown(grid, { key: "Enter" });
  fireEvent.keyDown(screen.getByLabelText("셀 편집"), { key: "Enter" });
  expect(document.activeElement).toBe(grid);
  fireEvent.keyDown(grid, { key: "Enter" });
  const nullButton = screen.getByRole("button", { name: "SQL NULL로 설정" });
  fireEvent.blur(screen.getByLabelText("셀 편집"), { relatedTarget: nullButton });
  fireEvent.click(nullButton);
  expect(editStore.getSnapshot("grid").updates.get(1)?.get("name")?.value).toBeNull();
});
test("paste inside an editor stays native; grid paste preserves quoted markers and rejects extra columns", () => {
  fireEvent.doubleClick(screen.getByText("Alpha"));
  fireEvent.paste(screen.getByLabelText("셀 편집"), { clipboardData: { getData: () => "native paste" } });
  expect(editStore.getSnapshot("grid").inserts).toHaveLength(0);
  fireEvent.keyDown(screen.getByLabelText("셀 편집"), { key: "Escape" });
  const grid = screen.getByRole("grid");
  fireEvent.paste(grid, { clipboardData: { getData: () => '"NULL"' } });
  expect(editStore.getSnapshot("grid").inserts[0].cells.name).toEqual({ mode: "value", value: "NULL" });
  fireEvent.paste(grid, { clipboardData: { getData: () => "extra\tcolumn" } });
  expect(editStore.getSnapshot("grid").inserts).toHaveLength(1);
  expect(screen.getByRole("alert").textContent).toContain("열 수");
});

test("copies a rectangle to another result at the selected cell without inserting rows", async () => {
  const source = screen.getByRole("grid");
  fireEvent.mouseDown(within(source).getByRole("gridcell", { name: "1" }));
  fireEvent.mouseEnter(within(source).getByText("Beta"), { buttons: 1 });
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  await act(async () => { fireEvent.keyDown(source, { key: "c", ctrlKey: true }); });
  expect(writeText).toHaveBeenCalledWith("1\tAlpha\n2\tBeta");

  resultStore.create("target");
  resultStore.setColumns("target", ["untouched", "id", "name"].map((name, index) => ({
    ...resultStore.getSnapshot("grid").columns[0], name, index,
  })));
  const original: DbValue[][] = [0, 1, 2].map((r) => ["keep", `old-id-${r}`, `old-name-${r}`].map((value) => ({ kind: "text", value })));
  resultStore.pushRows("target", original);
  resultStore.setTerminal("target", { status: "completed" });
  render(<ResultGrid resultTabId="target" edit={{ editableColumns: new Set(["id", "name"]) }} />);
  const target = screen.getAllByRole("grid")[1];
  fireEvent.mouseDown(within(target).getByText("old-id-1"));
  fireEvent.paste(target, { clipboardData: { getData: () => writeText.mock.calls[0][0] } });
  expect(editStore.getSnapshot("target").inserts).toHaveLength(0);
  expect(editStore.getSnapshot("target").updates).toEqual(new Map([
    [1, new Map([["id", { value: "1" }], ["name", { value: "Alpha" }]])],
    [2, new Map([["id", { value: "2" }], ["name", { value: "Beta" }]])],
  ]));
  expect(resultStore.getSnapshot("target").rows).toEqual(original);
  expect(within(target).getByText("Alpha")).toBeTruthy();
  expect(editStore.getSnapshot("grid").pendingCount).toBe(0);
  cleanup();
  resultStore.dispose("target");
});

test.each([
  ["Alpha", "changed\nsecond\nextra"],
  ["Alpha", "changed\textra"],
  ["1", "changed\tsecond"],
  ["Alpha", "changed\nDEFAULT"],
])("rejects an invalid selected paste atomically: %s / %s", (cell, text) => {
  fireEvent.mouseDown(screen.getByRole("gridcell", { name: cell }));
  fireEvent.paste(screen.getByRole("grid"), { clipboardData: { getData: () => text } });
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(editStore.getSnapshot("grid").pendingCount).toBe(0);
});

test("selected paste distinguishes SQL NULL, literal markers and unchanged values", () => {
  const grid = screen.getByRole("grid");
  fireEvent.mouseDown(screen.getByText("Alpha"));
  fireEvent.paste(grid, { clipboardData: { getData: () => 'NULL\n"DEFAULT"' } });
  expect(editStore.getSnapshot("grid").updates.get(0)?.get("name")).toEqual({ value: null });
  expect(editStore.getSnapshot("grid").updates.get(1)?.get("name")).toEqual({ value: "DEFAULT" });
  fireEvent.paste(grid, { clipboardData: { getData: () => "Alpha\nBeta" } });
  expect(editStore.getSnapshot("grid").pendingCount).toBe(0);
  act(() => { resultStore.replaceRow("grid", 0, [{ kind: "text", value: "1" }, { kind: "null" }]); });
  fireEvent.mouseDown(screen.getByRole("gridcell", { name: "NULL" }));
  fireEvent.paste(grid, { clipboardData: { getData: () => '"NULL"' } });
  expect(editStore.getSnapshot("grid").updates.get(0)?.get("name")).toEqual({ value: "NULL" });
});

test("pastes into an explicitly added row without adding another insert", () => {
  fireEvent.click(screen.getByRole("button", { name: /행 추가/ }));
  const grid = screen.getByRole("grid");
  fireEvent.mouseDown(grid.querySelector('[data-cell="2:1"]')!);
  fireEvent.paste(grid, { clipboardData: { getData: () => "new name" } });
  expect(editStore.getSnapshot("grid").inserts).toHaveLength(1);
  expect(editStore.getSnapshot("grid").inserts[0].cells.name).toEqual({ mode: "value", value: "new name" });
  expect(editStore.getSnapshot("grid").updates.size).toBe(0);
});

test("selected paste respects save locks and deleted rows", () => {
  const grid = screen.getByRole("grid");
  fireEvent.mouseDown(screen.getByText("Alpha"));
  const paste = () => fireEvent.paste(grid, { clipboardData: { getData: () => "changed\nsecond" } });
  act(() => { editStore.setLocked("grid", true); });
  paste();
  expect(editStore.getSnapshot("grid").pendingCount).toBe(0);
  act(() => { editStore.setLocked("grid", false); editStore.toggleDelete("grid", 1); });
  paste();
  expect(screen.getByRole("alert").textContent).toContain("삭제");
  expect(editStore.getSnapshot("grid").updates.size).toBe(0);
  expect(editStore.getSnapshot("grid").inserts).toHaveLength(0);
});

test("copies all menu cells including text[] to another editable result and builds updates", async () => {
  cleanup();
  const meta: TableMetadata = { relationOid: 42, schema: "adm", name: "menus", kind: "table", primaryKey: [1], uniqueKeys: [], rowLevelSecurity: false,
    columns: [
      { attributeNumber: 1, name: "id", pgTypeOid: 20, pgTypeName: "bigint", nullable: false, defaultExpr: null, comment: null, isGenerated: false, isPrimaryKey: true },
      { attributeNumber: 2, name: "api_prefixes", pgTypeOid: 1009, pgTypeName: "text[]", nullable: false, defaultExpr: "'{}'::text[]", comment: null, isGenerated: false, isPrimaryKey: false },
    ] };
  const cols = [
    { index: 0, name: "__dbpod_xmin", pgTypeOid: 25, pgTypeName: "text", category: "text" as const, source: null, nullable: null, editable: false },
    ...meta.columns.map((c, index) => ({ index: index + 1, name: c.name, pgTypeOid: c.pgTypeOid, pgTypeName: c.pgTypeName,
      category: index === 0 ? "integer" as const : "array" as const, source: { relationOid: 42, attributeNumber: c.attributeNumber }, nullable: false, editable: false })),
  ];
  const values: DbValue[] = [{ kind: "text", value: "/narrative-args" }, { kind: "text", value: "a,b" }, { kind: "text", value: "NULL" }, { kind: "null" }, { kind: "text", value: 'a"b\\c' }];
  const array: DbValue = { kind: "array", elementTypeOid: 25, dimensions: [{ lowerBound: 1, length: values.length }], values };
  const empty: DbValue = { kind: "array", elementTypeOid: 25, dimensions: [{ lowerBound: 1, length: 0 }], values: [] };
  const info = tableDataEditability(cols, meta, false);
  expect(info.editable).toBe(true);
  if (!info.editable) throw new Error("menus must be editable");
  for (const id of ["menu-source", "menu-target"]) {
    resultStore.create(id);
    resultStore.setColumns(id, cols);
    resultStore.pushRows(id, [array, empty].map((v, r) => [{ kind: "text", value: "11" }, { kind: "integer", value: String(r + 1) }, id === "menu-source" ? v : empty]));
    resultStore.setTerminal(id, { status: "completed" });
    render(<ResultGrid resultTabId={id} hiddenColumns={["__dbpod_xmin"]} edit={info} />);
  }
  const [source, target] = screen.getAllByRole("grid");
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  fireEvent.keyDown(source, { key: "a", code: "KeyA", metaKey: true });
  await act(async () => { fireEvent.keyDown(source, { key: "c", ctrlKey: true }); });
  fireEvent.mouseDown(within(target).getByRole("gridcell", { name: "1" }));
  fireEvent.paste(target, { clipboardData: { getData: () => writeText.mock.calls[0][0] } });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(editStore.getSnapshot("menu-target").inserts).toHaveLength(0);
  const changes = buildRowChanges(info, resultStore.getSnapshot("menu-target"), editStore.getSnapshot("menu-target"));
  expect(changes).toHaveLength(1);
  expect(changes[0]).toMatchObject({ operation: "update", changes: {
    api_prefixes: { kind: "text", value: String.raw`{"/narrative-args","a,b","NULL",NULL,"a\"b\\c"}` },
  } });
  // Enter without typing must not turn ambiguous array display text into an edit.
  fireEvent.mouseDown(within(source).getAllByRole("gridcell")[1]);
  fireEvent.keyDown(source, { key: "Enter" });
  fireEvent.keyDown(screen.getByLabelText("셀 편집"), { key: "Enter" });
  expect(editStore.getSnapshot("menu-source").pendingCount).toBe(0);
  cleanup();
  for (const id of ["menu-source", "menu-target"]) resultStore.dispose(id);
});

test("row headers and Shift+Space select full rows; deletion requires the separate action", async () => {
  const grid = screen.getByRole("grid");
  const selected = () => screen.getAllByRole("gridcell").filter((cell) => cell.getAttribute("aria-selected") === "true").map((cell) => cell.textContent);
  fireEvent.click(screen.getByRole("button", { name: "2행 선택" }));
  expect(selected()).toEqual(["2", "Beta"]);
  expect(editStore.getSnapshot("grid").pendingCount).toBe(0);
  expect(document.activeElement).toBe(grid);
  fireEvent.mouseDown(screen.getByText("Alpha"));
  expect(selected()).toEqual(["Alpha"]);
  fireEvent.keyDown(grid, { key: " ", code: "Space", shiftKey: true });
  expect(selected()).toEqual(["1", "Alpha"]);
  expect(editStore.getSnapshot("grid").pendingCount).toBe(0);
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  await act(async () => { fireEvent.keyDown(grid, { key: "c", ctrlKey: true }); });
  expect(writeText).toHaveBeenCalledWith("1\tAlpha");
  fireEvent.click(screen.getByRole("button", { name: "선택 행 삭제" }));
  expect(editStore.getSnapshot("grid").deletes).toEqual(new Set([0]));
  expect(resultStore.getSnapshot("grid").rows).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "선택 행 삭제 취소" }));
  expect(editStore.getSnapshot("grid").deletes.size).toBe(0);
  // Backspace is the same toggle as the button, and only over whole rows.
  fireEvent.keyDown(grid, { key: "Backspace" });
  expect(editStore.getSnapshot("grid").deletes).toEqual(new Set([0]));
  fireEvent.keyDown(grid, { key: "Backspace" });
  expect(editStore.getSnapshot("grid").deletes.size).toBe(0);
  fireEvent.mouseDown(screen.getByText("Alpha"));
  fireEvent.keyDown(grid, { key: "Backspace" });
  expect(editStore.getSnapshot("grid").deletes.size).toBe(0);
  fireEvent.keyDown(grid, { key: " ", code: "Space", shiftKey: true });
  fireEvent.click(screen.getByRole("button", { name: /행 추가/ }));
  fireEvent.click(screen.getByRole("button", { name: "새 1행 선택" }));
  expect(editStore.getSnapshot("grid").inserts).toHaveLength(1);
  expect(selected()).toEqual(["DEFAULT", "DEFAULT"]);
  fireEvent.click(screen.getByRole("button", { name: "선택 행 삭제" }));
  expect(editStore.getSnapshot("grid").inserts).toHaveLength(0);
  cleanup();
  render(<ResultGrid resultTabId="grid" />);
  fireEvent.click(screen.getByRole("button", { name: "2행 선택" }));
  expect(selected()).toEqual(["2", "Beta"]);
  expect(screen.queryByRole("button", { name: "선택 행 삭제" })).toBeNull();
});

const rows = (from: number, count: number): DbValue[][] => Array.from({ length: count }, (_, i) => [
  { kind: "text", value: String(from + i) }, { kind: "text", value: `name ${from + i}` },
]);

function pagedResult() {
  const columns = resultStore.getSnapshot("grid").columns;
  act(() => {
    resultStore.dispose("grid");
    resultStore.create("grid", "SELECT * FROM example", true);
    resultStore.setStarted("grid", "paged-execution");
    resultStore.setColumns("grid", columns);
    resultStore.appendRows("grid", 0, rows(1, 200));
    resultStore.setTerminal("grid", { status: "completed", rowCount: 450 });
  });
}

function tableResult() {
  const columns = resultStore.getSnapshot("grid").columns;
  act(() => {
    resultStore.dispose("grid");
    resultStore.create("grid", undefined, false, { connectionId: "A", queryTabId: "A-tab", pageSize: 200 });
    resultStore.setStarted("grid", "table-execution");
    resultStore.setColumns("grid", columns);
    resultStore.appendRows("grid", 0, rows(1, 200));
    resultStore.setTerminal("grid", { status: "completed", rowCount: 200, truncated: false });
  });
}

test("scrolls a Table Data result into the backend's next page", async () => {
  tableResult();
  const grid = screen.getByRole("grid");
  Object.defineProperties(grid, {
    clientHeight: { value: 300 },
    scrollHeight: { get: () => resultStore.getSnapshot("grid").rows.length * 28 },
  });
  expect(screen.getByText(/아래로 스크롤하여 추가 조회/).textContent).not.toContain("/ 200행");
  vi.mocked(ipc.tableDataFetchPage).mockResolvedValueOnce({ rows: rows(201, 200), nextOffset: 400, hasMore: false });
  grid.scrollTop = 5200;
  await act(async () => {
    fireEvent.scroll(grid);
    fireEvent.scroll(grid);
  });
  expect(ipc.tableDataFetchPage).toHaveBeenCalledTimes(1);
  expect(ipc.tableDataFetchPage).toHaveBeenCalledWith({ connectionId: "A", queryTabId: "A-tab", resultTabId: "grid", executionId: "table-execution" });
  expect(ipc.resultRowsFetch).not.toHaveBeenCalled();
  expect(resultStore.getSnapshot("grid").rows).toEqual(rows(1, 400));
  expect(screen.getByText(/400행 표시/).textContent).not.toContain("/ 200행");
});

test("exports only loaded Table Data rows without advancing its next page", async () => {
  tableResult();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "JSON" })); });
  const exported = JSON.parse(vi.mocked(ipc.exportSave).mock.calls[0][0].content);
  expect(exported).toEqual(Array.from({ length: 200 }, (_, i) => ({ id: String(i + 1), name: `name ${i + 1}` })));
  expect(ipc.tableDataFetchPage).not.toHaveBeenCalled();
  expect(ipc.resultRowsFetch).not.toHaveBeenCalled();
  expect(resultStore.getSnapshot("grid").hasMoreRows).toBe(true);
});

test("loads another 200 rows near the scroll end, deduplicates requests and retries errors", async () => {
  pagedResult();
  const grid = screen.getByRole("grid");
  Object.defineProperties(grid, {
    clientHeight: { value: 300 },
    scrollHeight: { get: () => resultStore.getSnapshot("grid").rows.length * 28 },
  });
  expect(resultStore.getSnapshot("grid").rows).toHaveLength(200);
  expect(ipc.resultRowsFetch).not.toHaveBeenCalled();
  act(() => { editStore.addInsert("grid"); });
  fireEvent.click(screen.getByRole("button", { name: "새 1행 선택" }));
  let finish!: (page: ResultRowsFetchResponse) => void;
  vi.mocked(ipc.resultRowsFetch).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  grid.scrollTop = 5200;
  fireEvent.scroll(grid);
  fireEvent.scroll(grid);
  expect(ipc.resultRowsFetch).toHaveBeenCalledTimes(1);
  expect(ipc.resultRowsFetch).toHaveBeenLastCalledWith({ resultTabId: "grid", executionId: "paged-execution", offset: 200 });
  await act(async () => { finish({ rows: rows(201, 200), nextOffset: 400, hasMore: true }); });
  expect(resultStore.getSnapshot("grid").rows).toHaveLength(400);
  expect(screen.getAllByRole("gridcell").filter((cell) => cell.getAttribute("aria-selected") === "true").map((cell) => cell.textContent)).toEqual(["DEFAULT", "DEFAULT"]);
  expect(grid.scrollTop).toBe(5200);
  vi.mocked(ipc.resultRowsFetch).mockRejectedValueOnce(new Error("page unavailable"));
  grid.scrollTop = 10800;
  await act(async () => { fireEvent.scroll(grid); });
  expect(screen.getByRole("alert").textContent).toContain("page unavailable");
  vi.mocked(ipc.resultRowsFetch).mockResolvedValueOnce({ rows: rows(401, 50), nextOffset: 450, hasMore: false });
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await waitFor(() => expect(resultStore.getSnapshot("grid").rows).toHaveLength(450));
  expect(resultStore.getSnapshot("grid").rows[400][0]).toEqual({ kind: "text", value: "401" });
  expect(resultStore.getSnapshot("grid").hasMoreRows).toBe(false);
  fireEvent.scroll(grid);
  expect(ipc.resultRowsFetch).toHaveBeenCalledTimes(3);
});

test("exports unloaded rows too without expanding the visible result", async () => {
  pagedResult();
  vi.mocked(ipc.resultRowsFetch).mockResolvedValueOnce({ rows: rows(201, 200), nextOffset: 400, hasMore: true })
    .mockResolvedValueOnce({ rows: rows(401, 50), nextOffset: 450, hasMore: false });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "JSON" })); });
  const exported = JSON.parse(vi.mocked(ipc.exportSave).mock.calls[0][0].content);
  expect(exported).toHaveLength(450);
  expect(resultStore.getSnapshot("grid").rows).toHaveLength(200);
});

test("keeps a dragged column width when another result is shown and back again", () => {
  const header = () => screen.getAllByRole("columnheader").find((cell) => cell.textContent?.startsWith("name"))!;
  const handle = header().querySelector('[role="presentation"]')!;
  expect(header().style.width).toBe("200px");

  fireEvent.pointerDown(handle, { clientX: 100 });
  act(() => {
    document.dispatchEvent(new PointerEvent("pointermove", { clientX: 260 }));
    document.dispatchEvent(new PointerEvent("pointerup"));
  });
  expect(header().style.width).toBe("360px");

  // Switching Result tabs unmounts the grid; the width belongs to the result.
  cleanup();
  render(<ResultGrid resultTabId="grid" edit={{ editableColumns: new Set(["name"]) }} />);
  expect(header().style.width).toBe("360px");

  // Releasing the result drops its widths with it.
  act(() => { resultStore.dispose("grid"); });
  cleanup();
  resultStore.create("grid");
  resultStore.setColumns("grid", ["id", "name"].map((name, index) => ({ name, index, pgTypeOid: 25, pgTypeName: "text", category: "text", source: null, nullable: true, editable: false })));
  render(<ResultGrid resultTabId="grid" edit={{ editableColumns: new Set(["name"]) }} />);
  expect(header().style.width).toBe("200px");
});

test("Cmd+A selects every loaded cell and copies the whole grid", async () => {
  const grid = screen.getByRole("grid");
  const selected = () => screen.getAllByRole("gridcell").filter((cell) => cell.getAttribute("aria-selected") === "true").map((cell) => cell.textContent);
  fireEvent.mouseDown(screen.getByText("Alpha"));
  expect(selected()).toEqual(["Alpha"]);

  fireEvent.keyDown(grid, { key: "a", code: "KeyA", metaKey: true });
  expect(selected()).toEqual(["1", "Alpha", "2", "Beta"]);

  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  await act(async () => { fireEvent.keyDown(grid, { key: "c", ctrlKey: true }); });
  expect(writeText).toHaveBeenCalledWith("1\tAlpha\n2\tBeta");

  // Rows added but not yet saved are part of the grid too.
  fireEvent.click(screen.getByRole("button", { name: /행 추가/ }));
  fireEvent.keyDown(grid, { key: "a", code: "KeyA", metaKey: true });
  expect(selected()).toHaveLength(6);
});
