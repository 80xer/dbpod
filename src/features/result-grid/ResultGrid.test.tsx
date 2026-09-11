// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ResultGrid } from "./ResultGrid";
import { resultStore } from "../../entities/result/resultStore";
import { editStore } from "../../entities/result/editStore";
import { ipc } from "../../shared/ipc/invoke";
import type { DbValue, ResultRowsFetchResponse } from "../../generated/ipc-types";
vi.mock("@tanstack/react-virtual", () => ({ useVirtualizer: ({ count }: { count: number }) => ({ getTotalSize: () => count * 28, scrollToIndex: vi.fn(), getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 28, size: 28 })) }) }));
vi.mock("../../shared/ipc/invoke", () => ({ ipc: { exportSave: vi.fn(), resultRowsFetch: vi.fn() } }));
beforeEach(() => {
  vi.clearAllMocks();
  resultStore.dispose("grid"); resultStore.create("grid");
  resultStore.setColumns("grid", ["id", "name"].map((name, index) => ({ name, index, pgTypeOid: 25, pgTypeName: "text", category: "text", source: null, nullable: true, editable: false })));
  resultStore.pushRows("grid", [[{ kind: "text", value: "1" }, { kind: "text", value: "Alpha" }], [{ kind: "text", value: "2" }, { kind: "text", value: "Beta" }]]);
  resultStore.setTerminal("grid", { status: "completed" });
  render(<ResultGrid resultTabId="grid" edit={{ editableColumns: new Set(["name"]) }} />);
});
afterEach(cleanup);
test("keyboard navigation edits the focused cell and Escape discards the active editor", () => {
  const grid = screen.getByRole("grid");
  fireEvent.keyDown(grid, { key: "ArrowDown" }); fireEvent.keyDown(grid, { key: "ArrowRight" }); fireEvent.keyDown(grid, { key: "Enter" });
  const input = screen.getByLabelText("셀 편집"); expect((input as HTMLInputElement).value).toBe("Beta");
  fireEvent.change(input, { target: { value: "changed" } }); fireEvent.keyDown(input, { key: "Escape" });
  expect(editStore.getSnapshot("grid").pendingCount).toBe(0);
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
