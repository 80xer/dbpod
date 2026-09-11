// @vitest-environment jsdom
import { StrictMode } from "react";
import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { afterEach, expect, it, vi } from "vitest";
import { openConnections } from "../../entities/connection/openConnections";
import { resultStore } from "../../entities/result/resultStore";
import { dispatchWorkspace, emptyWorkspace, resultIds, sqlDrafts, workspaceStates } from "../../entities/workspace/workspaceStore";
import { ipc } from "../../shared/ipc/invoke";
import { router } from "../router";

vi.hoisted(() => {
  Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
});

vi.mock("@tauri-apps/api/core", () => ({ Channel: class { onmessage = () => undefined; } }));
vi.mock("../../shared/ipc/invoke", () => ({ ipc: {
  queryExecute: vi.fn(), queryAckChunk: vi.fn(), resultRelease: vi.fn(), querySessionClose: vi.fn(),
} }));
vi.mock("../../entities/workspace/persistence", () => ({
  restoreWorkspace: vi.fn(), saveWorkspaceSoon: vi.fn(), saveWorkspaceNow: vi.fn(),
  getPersistenceError: () => "", subscribePersistence: () => () => undefined,
}));
vi.mock("../../features/object-explorer/ObjectSidebar", () => ({ ObjectSidebar: () => null }));
// jsdom has no layout; keep the real grid but expose its rows to the viewport.
vi.mock("@tanstack/react-virtual", () => ({ useVirtualizer: ({ count }: { count: number }) => ({
  getTotalSize: () => count * 28, scrollToIndex: vi.fn(),
  getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 28, size: 28 })),
}) }));

let client: QueryClient;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  for (const state of workspaceStates.values()) for (const tab of state.tabs) for (const id of resultIds(tab)) resultStore.dispose(id);
  workspaceStates.clear();
  sqlDrafts.clear();
  for (const [id] of openConnections.entries()) openConnections.delete(id);
});

it("executes typed SQL in a split CodeMirror editor and renders its own result cells under StrictMode", async () => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  openConnections.set("conn", {
    id: "profile", name: "Dev", environment: "dev", database: "db", host: "localhost", port: 5432,
    username: "tester", color: null, tlsMode: "verify-full", readOnly: true, queryTimeoutMs: 60000,
    maxRows: 500, hasStoredCredential: false,
  });
  workspaceStates.set("conn", emptyWorkspace());
  dispatchWorkspace("conn", { type: "TAB_ADDED", tabId: "left", title: "Left" });
  sqlDrafts.set("left", "SELECT 'left';");
  vi.mocked(ipc.queryAckChunk).mockResolvedValue(undefined);
  vi.mocked(ipc.queryExecute).mockImplementation(async (request, channel) => {
    const executionId = `execution:${request.resultTabId}`;
    // Native IPC accepts the request before its streamed result arrives.
    setTimeout(() => {
      channel.onmessage({ type: "started", executionId, backendPid: 123, startedAt: "2026-09-10T00:00:00Z" });
      channel.onmessage({ type: "columns", executionId, columns: [{ name: "value", index: 0, pgTypeOid: 25, pgTypeName: "text", category: "text", source: null, nullable: true, editable: false }] });
      channel.onmessage({ type: "rows", executionId, sequence: 0, rows: [[{ kind: "text", value: request.sql.includes("right2") ? "SECOND RIGHT RESULT" : request.sql.includes("right") ? "RIGHT RESULT" : "LEFT RESULT" }]] });
      channel.onmessage({ type: "completed", executionId, rowCount: 1, truncated: false, durationMs: 1, transactionState: "idle" });
    }, 0);
    return { executionId, sessionId: `session:${request.queryTabId}` };
  });
  const testRouter = createRouter({ routeTree: router.options.routeTree, history: createMemoryHistory({ initialEntries: ["/workspace/conn"] }) });
  await testRouter.load();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<StrictMode><QueryClientProvider client={client}><RouterProvider router={testRouter} /></QueryClientProvider></StrictMode>);
  const left = await screen.findByLabelText("SQL 편집기");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "▶ 실행" })); });
  expect(await screen.findByRole("gridcell", { name: "LEFT RESULT" })).toBeTruthy();
  await act(async () => { fireEvent.keyDown(left, { key: "d", code: "KeyD", metaKey: true }); });
  const right = screen.getAllByLabelText("SQL 편집기")[1];
  expect(document.activeElement).toBe(right);
  const view = EditorView.findFromDOM(right)!;
  await act(async () => { view.dispatch({ changes: { from: 0, insert: "SELECT 'right';" }, selection: { anchor: 15 } }); });
  await act(async () => { fireEvent.keyDown(document.activeElement!, { key: "Enter", code: "Enter", metaKey: true }); });
  expect(ipc.queryExecute).toHaveBeenLastCalledWith(expect.objectContaining({ sql: "SELECT 'right'", queryTabId: workspaceStates.get("conn")!.activeTabId }), expect.anything());
  const rightRegion = right.closest("section")!;
  expect(await within(rightRegion).findByRole("gridcell", { name: "RIGHT RESULT" })).toBeTruthy();
  expect(within(left.closest("section")!).getByRole("gridcell", { name: "LEFT RESULT" })).toBeTruthy();
  const firstRightTab = workspaceStates.get("conn")!.tabs[1];
  const leftBar = screen.getByRole("tablist", { name: "쿼리 영역 1 탭" });
  const rightBar = screen.getByRole("tablist", { name: "쿼리 영역 2 탭" });
  expect(within(leftBar).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Left"]);
  expect(within(rightBar).getAllByRole("tab").map((tab) => tab.textContent)).toEqual([firstRightTab.title]);

  await act(async () => { fireEvent.click(within(rightRegion).getByRole("button", { name: "새 쿼리 탭" })); });
  const secondRightTab = workspaceStates.get("conn")!.tabs[2];
  const secondRight = within(rightRegion).getByLabelText("SQL 편집기");
  expect(document.activeElement).toBe(secondRight);
  expect(within(left.closest("section")!).getByLabelText("SQL 편집기")).toBe(left);
  expect(within(rightBar).getAllByRole("tab")).toHaveLength(2);
  await act(async () => { EditorView.findFromDOM(secondRight)!.dispatch({ changes: { from: 0, insert: "SELECT 'right2';" } }); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "▶ 실행" })); });
  expect(await within(rightRegion).findByRole("gridcell", { name: "SECOND RIGHT RESULT" })).toBeTruthy();
  expect(ipc.queryExecute).toHaveBeenLastCalledWith(expect.objectContaining({ queryTabId: secondRightTab.id }), expect.anything());

  await act(async () => { fireEvent.click(within(rightBar).getByRole("tab", { name: firstRightTab.title })); });
  const restoredRight = within(rightRegion).getByLabelText("SQL 편집기");
  expect(document.activeElement).toBe(restoredRight);
  expect(EditorView.findFromDOM(restoredRight)!.state.doc.toString()).toBe("SELECT 'right';");
  expect(within(rightRegion).getByRole("gridcell", { name: "RIGHT RESULT" })).toBeTruthy();
  await act(async () => { fireEvent.keyDown(document.activeElement!, { key: "Enter", code: "Enter", metaKey: true }); });
  expect(ipc.queryExecute).toHaveBeenLastCalledWith(expect.objectContaining({ queryTabId: firstRightTab.id, sql: "SELECT 'right'" }), expect.anything());
  await act(async () => { fireEvent.keyDown(document.activeElement!, { key: "Tab", ctrlKey: true }); });
  expect(workspaceStates.get("conn")!.activeTabId).toBe(secondRightTab.id);
  expect(within(rightRegion).getByRole("gridcell", { name: "SECOND RIGHT RESULT" })).toBeTruthy();
  expect(within(left.closest("section")!).getByRole("gridcell", { name: "LEFT RESULT" })).toBeTruthy();

  await waitFor(() => expect(workspaceStates.get("conn")!.tabs.find((tab) => tab.id === firstRightTab.id)?.runningExecutionId).toBeUndefined());
  await act(async () => { fireEvent.click(within(left.closest("section")!).getByRole("button", { name: "새 쿼리 탭" })); });
  expect(within(leftBar).getAllByRole("tab")).toHaveLength(2);
  expect(within(rightBar).getAllByRole("tab")).toHaveLength(2);
  await act(async () => { fireEvent.click(within(leftBar).getByRole("tab", { name: "Left" })); });
  expect(within(screen.getByRole("region", { name: "쿼리 영역 1" })).getByRole("gridcell", { name: "LEFT RESULT" })).toBeTruthy();
  await act(async () => { fireEvent.click(within(rightRegion).getByRole("button", { name: "분할 영역 닫기" })); });
  expect(screen.queryByRole("region", { name: "쿼리 영역 2" })).toBeNull();
  expect(ipc.querySessionClose).toHaveBeenCalledWith({ sessionId: `session:${firstRightTab.id}`, rollbackOpenTransaction: true });
  expect(ipc.querySessionClose).toHaveBeenCalledWith({ sessionId: `session:${secondRightTab.id}`, rollbackOpenTransaction: true });
  expect(ipc.querySessionClose).not.toHaveBeenCalledWith(expect.objectContaining({ sessionId: "session:left" }));
  expect(screen.getByRole("gridcell", { name: "LEFT RESULT" })).toBeTruthy();
});
