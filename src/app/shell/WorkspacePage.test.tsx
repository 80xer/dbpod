// @vitest-environment jsdom
import type { Channel } from "@tauri-apps/api/core";
import type { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openConnections } from "../../entities/connection/openConnections";
import { historyStore } from "../../entities/query/historyStore";
import { editStore } from "../../entities/result/editStore";
import { resultStore } from "../../entities/result/resultStore";
import { dispatchWorkspace, emptyWorkspace, getTabGroups, resultIds, sqlDrafts, tableDataViews, workspaceStates } from "../../entities/workspace/workspaceStore";
import type { ConnectionProfile, ExecutionAccepted, QueryStreamEvent } from "../../generated/ipc-types";
import { ipc } from "../../shared/ipc/invoke";
import { restoreWorkspace, saveWorkspaceNow } from "../../entities/workspace/persistence";
import { router } from "../router";

vi.mock("@tauri-apps/api/core", () => ({ Channel: class<T> { onmessage: (event: T) => void = () => undefined; } }));
vi.mock("../../shared/ipc/invoke", () => ({ ipc: {
  queryExecute: vi.fn(), queryCancel: vi.fn(), tableDataExecute: vi.fn(), queryAckChunk: vi.fn(), metadataGetTable: vi.fn(),
  resultRelease: vi.fn(), querySessionClose: vi.fn(), connectionClose: vi.fn(),
  connectionSwitchDatabase: vi.fn(), metadataGetRoutineDefinition: vi.fn(),
} }));
vi.mock("../../entities/workspace/persistence", () => ({
  restoreWorkspace: vi.fn(), saveWorkspaceSoon: vi.fn(), saveWorkspaceNow: vi.fn(), preloadSnapshot: vi.fn(),
  getPersistenceError: () => "", subscribePersistence: () => () => undefined,
}));
vi.mock("../../features/connections/ConnectionsPage", () => ({ ConnectionsPage: () => null }));
vi.mock("../../features/result-grid/QueryResultPane", () => ({ QueryResultPane: () => null }));
vi.mock("../../features/result-grid/ResultGrid", () => ({ ResultGrid: () => null }));
vi.mock("../../features/object-explorer/ObjectSidebar", () => ({
  ObjectSidebar: ({ onOpenObject, onChangeDatabase }: { onOpenObject: (table: { oid: number; schema: string; name: string; kind?: string; functionArguments?: string }) => void; onChangeDatabase: (database: string) => void }) => <>
    <button onClick={() => onOpenObject({ oid: 100, schema: "public", name: "alpha" })}>Open alpha</button>
    <button onClick={() => onOpenObject({ oid: 101, schema: "public", name: "beta" })}>Open beta</button>
    <button onClick={() => onOpenObject({ oid: 201, schema: "public", name: "lookup", kind: "function", functionArguments: "integer" })}>Open function</button>
    <button onClick={() => onOpenObject({ oid: 202, schema: "public", name: "refresh_cache", kind: "function", functionArguments: "" })}>Open procedure</button>
    <button onClick={() => onChangeDatabase("analytics")}>Open analytics DB</button>
    <button onClick={() => onChangeDatabase("db")}>Open default DB</button>
  </>,
}));
vi.mock("../../features/query-editor/SqlEditor", async () => {
  const { useEffect, useRef } = await import("react");
  return { SqlEditor: ({ initialSql, readOnly, onViewReady, onDocChanged, onRun }: {
    initialSql: string; readOnly?: boolean; onViewReady?: (view: EditorView | null) => void; onDocChanged?: (sql: string) => void;
    onRun?: () => void;
  }) => {
    const sql = useRef(initialSql);
    const input = useRef<HTMLTextAreaElement>(null);
    useEffect(() => {
      onViewReady?.({ focus: () => input.current?.focus(), state: { selection: { main: { from: 0, to: 0 } }, doc: { toString: () => sql.current } } } as unknown as EditorView);
      return () => onViewReady?.(null);
    }, []);
    return <textarea ref={input} aria-label={readOnly ? "정의 SQL" : "SQL"} readOnly={readOnly} defaultValue={initialSql} onKeyDown={(event) => {
      if (!readOnly && (event.metaKey || event.ctrlKey) && event.key === "Enter") onRun?.();
    }} onChange={(event) => {
      sql.current = event.target.value;
      onDocChanged?.(sql.current);
    }} />;
  } };
});

const profile = (id: string): ConnectionProfile => ({ id, name: id, environment: "local", color: null, host: "localhost", port: 5432, database: "db", username: "user", tlsMode: "verify-full", readOnly: false, queryTimeoutMs: 60000, maxRows: 500, hasStoredCredential: false });
const tab = (connectionId = "A") => workspaceStates.get(connectionId)!.tabs.find((item) => item.id === `${connectionId}-tab`)!;
const runButton = () => screen.getByRole("button", { name: "▶ 실행" }) as HTMLButtonElement;
const editor = () => screen.getByRole("textbox", { name: "SQL" }) as HTMLTextAreaElement;
let client: QueryClient | undefined;

function complete(channel: Channel<QueryStreamEvent>, executionId: string, count = 1) {
  channel.onmessage({ type: "started", executionId, backendPid: 123, startedAt: "2026-09-07T00:00:00Z" });
  channel.onmessage({ type: "rows", executionId, sequence: 0, rows: Array.from({ length: count }, (_, index) => [{ kind: "integer", value: String(index + 2) }]) });
  channel.onmessage({ type: "completed", executionId, rowCount: count, truncated: false, durationMs: 1, transactionState: "idle" });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  workspaceStates.clear();
  sqlDrafts.clear();
  tableDataViews.clear();
  historyStore.clear();
  for (const id of ["A", "B"]) {
    openConnections.set(id, profile(id));
    workspaceStates.set(id, emptyWorkspace());
    dispatchWorkspace(id, { type: "TAB_ADDED", tabId: `${id}-tab`, title: `${id} query` });
    sqlDrafts.set(`${id}-tab`, `SELECT '${id}'`);
  }
  vi.mocked(ipc.queryAckChunk).mockResolvedValue(undefined);
  vi.mocked(ipc.queryExecute).mockImplementation(async (request, channel) => {
    const executionId = `query:${request.resultTabId}`;
    complete(channel, executionId);
    return { executionId, sessionId: `session:${request.queryTabId}` };
  });
  vi.mocked(ipc.tableDataExecute).mockImplementation(async (request, channel) => {
    const executionId = `table:${request.resultTabId}`;
    complete(channel, executionId, 200);
    return { executionId, sessionId: `session:${request.queryTabId}` };
  });
  vi.mocked(ipc.metadataGetTable).mockImplementation(async ({ relationOid }) => ({ relationOid, schema: "public", name: relationOid === 100 ? "alpha" : "beta", kind: "table", columns: [], primaryKey: [], uniqueKeys: [], rowLevelSecurity: false }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  client?.clear();
  for (const state of workspaceStates.values()) for (const workTab of state.tabs) for (const id of resultIds(workTab)) resultStore.dispose(id);
  workspaceStates.clear();
  sqlDrafts.clear();
  tableDataViews.clear();
  historyStore.clear();
  for (const [id] of openConnections.entries()) openConnections.delete(id);
});

async function mountWorkspace() {
  const testRouter = createRouter({ routeTree: router.options.routeTree, history: createMemoryHistory({ initialEntries: ["/workspace/A"] }) });
  await testRouter.load();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}><RouterProvider router={testRouter} /></QueryClientProvider>);
  await screen.findByRole("tab", { name: "A query" });
  return testRouter;
}

it("keeps each connection's tabs and SQL drafts when routing A → B → A", async () => {
  const testRouter = await mountWorkspace();
  fireEvent.change(editor(), { target: { value: "SELECT 'A changed'" } });
  await act(async () => { await testRouter.navigate({ to: "/workspace/$connectionId", params: { connectionId: "B" } }); });
  expect(editor().value).toBe("SELECT 'B'");
  expect(workspaceStates.get("B")!.tabs.map((item) => item.id)).toEqual(["B-tab"]);
  await act(async () => { fireEvent.click(runButton()); });
  expect(ipc.queryExecute).toHaveBeenCalledWith(expect.objectContaining({ connectionId: "B", queryTabId: "B-tab", sql: "SELECT 'B'" }), expect.anything());
  await act(async () => { await testRouter.navigate({ to: "/workspace/$connectionId", params: { connectionId: "A" } }); });
  expect(editor().value).toBe("SELECT 'A changed'");
  expect(workspaceStates.get("A")!.tabs.map((item) => item.id)).toEqual(["A-tab"]);
  expect(sqlDrafts.get("B-tab")).toBe("SELECT 'B'");
});

it.each(["HOME", "연결 추가"])("opens connections via %s and returns to the live workspace without disconnecting or losing results", async (linkName) => {
  const testRouter = await mountWorkspace();
  fireEvent.change(editor(), { target: { value: "SELECT 'preserved draft'" } });
  await act(async () => { fireEvent.click(runButton()); });
  const workspace = workspaceStates.get("A");
  const resultId = tab().activeResultTabId!;
  const rows = resultStore.getSnapshot(resultId).rows;
  const backspace = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
  fireEvent(runButton(), backspace);
  expect(backspace.defaultPrevented).toBe(true);
  expect(testRouter.state.location.pathname).toBe("/workspace/A");
  expect(screen.getByRole("link", { name: "HOME" }).textContent).toContain("HOME");
  expect(screen.getByRole("link", { name: "연결 추가" }).textContent).toBe("+");
  await act(async () => { fireEvent.click(screen.getByRole("link", { name: linkName })); });
  await waitFor(() => expect(testRouter.state.location.pathname).toBe("/"));
  expect(openConnections.get("A")).toBeDefined();
  expect(workspaceStates.get("A")).toBe(workspace);
  expect(resultStore.getSnapshot(resultId).rows).toBe(rows);
  await act(async () => { fireEvent.click(screen.getByRole("link", { name: "A / db" })); });
  await waitFor(() => expect(editor().value).toBe("SELECT 'preserved draft'"));
  expect(tab().activeResultTabId).toBe(resultId);
  expect(ipc.queryExecute).toHaveBeenCalledTimes(1);
  expect(ipc.connectionClose).not.toHaveBeenCalled();
  expect(ipc.querySessionClose).not.toHaveBeenCalled();
  expect(ipc.resultRelease).not.toHaveBeenCalled();
});

it("splits beside the current editor, runs each pane independently and preserves work across HOME and pane closure", async () => {
  await mountWorkspace();
  const left = editor();
  fireEvent.change(left, { target: { value: "SELECT 'left'" } });
  await act(async () => { fireEvent.click(runButton()); });
  const leftResultId = tab().activeResultTabId!;
  const leftRows = resultStore.getSnapshot(leftResultId).rows;
  const editorKeyHandler = vi.fn();
  left.addEventListener("keydown", editorKeyHandler);
  const split = new KeyboardEvent("keydown", { key: "d", code: "KeyD", metaKey: true, bubbles: true, cancelable: true });
  await act(async () => { fireEvent(left, split); });
  expect(split.defaultPrevented).toBe(true);
  expect(editorKeyHandler).not.toHaveBeenCalled();
  const rightTab = workspaceStates.get("A")!.tabs[1];
  const rightRegion = screen.getByRole("region", { name: `${rightTab.title} 작업 영역` });
  const right = within(rightRegion).getByRole("textbox", { name: "SQL" }) as HTMLTextAreaElement;
  expect(screen.getAllByRole("textbox", { name: "SQL" })).toEqual([left, right]);
  expect(document.activeElement).toBe(right);
  expect(right.value).toBe("");
  expect(left.value).toBe("SELECT 'left'");
  expect(resultStore.getSnapshot(leftResultId).rows).toBe(leftRows);
  fireEvent.keyDown(right, { key: "d", metaKey: true, repeat: true });
  expect(workspaceStates.get("A")!.tabs).toHaveLength(2);

  fireEvent.change(right, { target: { value: "SELECT 'right'" } });
  await act(async () => { fireEvent.click(runButton()); });
  expect(ipc.queryExecute).toHaveBeenLastCalledWith(expect.objectContaining({ queryTabId: rightTab.id, sql: "SELECT 'right'" }), expect.anything());
  const rightResultId = workspaceStates.get("A")!.tabs[1].activeResultTabId!;
  expect(rightResultId).not.toBe(leftResultId);
  const separators = screen.getAllByRole("separator", { name: "에디터와 Result 영역 높이 조절" });
  expect(new Set(separators.map((element) => element.getAttribute("aria-controls"))).size).toBe(2);
  fireEvent.keyDown(separators[0], { key: "End" });
  expect(separators[0].getAttribute("aria-valuenow")).toBe("80");
  expect(separators[1].getAttribute("aria-valuenow")).toBe("40");
  await act(async () => { left.focus(); });
  await act(async () => { fireEvent.keyDown(left, { key: "Enter", metaKey: true }); });
  expect(ipc.queryExecute).toHaveBeenLastCalledWith(expect.objectContaining({ queryTabId: "A-tab", sql: "SELECT 'left'" }), expect.anything());
  expect(resultStore.getSnapshot(rightResultId).status).toBe("completed");

  await act(async () => { fireEvent.click(screen.getByRole("link", { name: "HOME" })); });
  await act(async () => { fireEvent.click(screen.getByRole("link", { name: "A / db" })); });
  await waitFor(() => expect(screen.getAllByRole("textbox", { name: "SQL" }).map((el) => (el as HTMLTextAreaElement).value)).toEqual(["SELECT 'left'", "SELECT 'right'"]));
  expect(getTabGroups(workspaceStates.get("A")!).map((group) => group.activeTabId)).toEqual(["A-tab", rightTab.id]);
  editStore.setCell(rightResultId, 0, "name", { value: "unsaved" });
  const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValue(true);
  const closeRight = () => within(screen.getByRole("region", { name: "쿼리 영역 2" })).getByRole("button", { name: "분할 영역 닫기" });
  await act(async () => { fireEvent.click(closeRight()); });
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(screen.getAllByRole("textbox", { name: "SQL" })).toHaveLength(2);
  expect(ipc.querySessionClose).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(closeRight()); });
  expect(editor().value).toBe("SELECT 'left'");
  expect(getTabGroups(workspaceStates.get("A")!)).toHaveLength(1);
  expect(ipc.resultRelease).toHaveBeenCalledWith({ resultTabId: rightResultId });
  expect(ipc.resultRelease).not.toHaveBeenCalledWith({ resultTabId: leftResultId });
  expect(tab().activeResultTabId).toBe(leftResultId);
  expect(ipc.connectionClose).not.toHaveBeenCalled();
});

it("keeps execution and cancellation tied to the focused pane while another pane is running", async () => {
  let channel!: Channel<QueryStreamEvent>;
  vi.mocked(ipc.queryExecute).mockImplementationOnce(async (_request, incoming) => {
    channel = incoming;
    return { executionId: "left-running", sessionId: "left-session" };
  });
  vi.mocked(ipc.queryCancel).mockResolvedValue({ state: "cancel-requested" });
  await mountWorkspace();
  const left = editor();
  await act(async () => { fireEvent.click(runButton()); });
  expect(runButton().disabled).toBe(true);
  await act(async () => { fireEvent.keyDown(left, { key: "d", ctrlKey: true }); });
  const right = screen.getAllByRole("textbox", { name: "SQL" })[1];
  expect(runButton().disabled).toBe(false);
  expect((screen.getByRole("button", { name: "■ 중지" }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { left.focus(); });
  expect(runButton().disabled).toBe(true);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "■ 중지" })); });
  expect(ipc.queryCancel).toHaveBeenCalledWith({ executionId: "left-running" });
  // Focusing a result-area control must not pull focus back into its editor.
  const rightSeparator = screen.getAllByRole("separator")[1];
  await act(async () => { rightSeparator.focus(); });
  expect(document.activeElement).toBe(rightSeparator);
  expect(runButton().disabled).toBe(false);
  fireEvent.change(right, { target: { value: "SELECT 'right'" } });
  await act(async () => { fireEvent.click(runButton()); });
  const focusedId = workspaceStates.get("A")!.activeTabId;
  await act(async () => { complete(channel, "left-running"); });
  expect(workspaceStates.get("A")!.activeTabId).toBe(focusedId);
  expect(tab().runningExecutionId).toBeUndefined();
  expect(screen.getAllByRole("textbox", { name: "SQL" })).toHaveLength(2);
});

it("moves through split panels and wraps tabs with the default arrow shortcuts", async () => {
  await mountWorkspace();
  await act(async () => {
    dispatchWorkspace("A", { type: "TAB_ADDED", tabId: "left-2" });
    dispatchWorkspace("A", { type: "TAB_ACTIVATED", tabId: "A-tab" });
    dispatchWorkspace("A", { type: "TAB_ADDED", tabId: "right-1", split: true });
    dispatchWorkspace("A", { type: "TAB_ADDED", tabId: "right-2" });
    dispatchWorkspace("A", { type: "TAB_ACTIVATED", tabId: "left-2" });
  });
  const press = (key: "ArrowLeft" | "ArrowRight", shiftKey = false) => fireEvent.keyDown(document.body, {
    key, code: key, metaKey: true, altKey: !shiftKey, shiftKey,
  });

  press("ArrowRight");
  expect(workspaceStates.get("A")!.activeTabId).toBe("right-1");
  press("ArrowLeft");
  expect(workspaceStates.get("A")!.activeTabId).toBe("left-2");
  await act(async () => { dispatchWorkspace("A", { type: "TAB_ACTIVATED", tabId: "right-2" }); });
  press("ArrowRight");
  expect(workspaceStates.get("A")!.activeTabId).toBe("A-tab");

  press("ArrowRight", true);
  expect(workspaceStates.get("A")!.activeTabId).toBe("right-2");
  press("ArrowLeft", true);
  expect(workspaceStates.get("A")!.activeTabId).toBe("A-tab");
});

it("closes the active tab with Cmd+W without closing the application", async () => {
  await mountWorkspace();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "새 쿼리 탭" })); });
  expect(workspaceStates.get("A")!.tabs).toHaveLength(2);
  const activeTabId = workspaceStates.get("A")!.activeTabId;
  const closeTab = new KeyboardEvent("keydown", { key: "w", code: "KeyW", metaKey: true, bubbles: true, cancelable: true });
  await act(async () => { fireEvent(editor(), closeTab); });
  await waitFor(() => expect(workspaceStates.get("A")!.tabs).toHaveLength(1));
  expect(workspaceStates.get("A")!.tabs[0].id).not.toBe(activeTabId);
  expect(closeTab.defaultPrevented).toBe(true);
  expect(ipc.connectionClose).not.toHaveBeenCalled();
});

it("opens function/procedure code in reusable read-only tabs, refreshes it and recovers from lookup failure", async () => {
  const functionSql = "CREATE OR REPLACE FUNCTION public.lookup(integer) RETURNS integer LANGUAGE sql AS 'SELECT $1';";
  const procedureSql = "CREATE OR REPLACE PROCEDURE public.refresh_cache() LANGUAGE sql AS 'SELECT 1';";
  let finish!: (sql: string) => void;
  vi.mocked(ipc.metadataGetRoutineDefinition).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const testRouter = await mountWorkspace();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Open function" })); });
  expect(screen.getByRole("status").textContent).toContain("정의 코드 불러오는 중");
  await act(async () => { finish(functionSql); });
  await screen.findByLabelText("정의 SQL");
  const code = () => screen.getByLabelText("정의 SQL") as HTMLTextAreaElement;
  expect(code().value).toBe(functionSql);
  expect(code().readOnly).toBe(true);
  expect(runButton().disabled).toBe(true);
  expect(ipc.metadataGetRoutineDefinition).toHaveBeenLastCalledWith({ connectionId: "A", routineOid: 201 });
  const functionTab = workspaceStates.get("A")!.activeTabId;
  expect(sqlDrafts.has(functionTab!)).toBe(false);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Open function" })); });
  expect(workspaceStates.get("A")!.tabs).toHaveLength(2);
  expect(workspaceStates.get("A")!.activeTabId).toBe(functionTab);
  vi.mocked(ipc.metadataGetRoutineDefinition).mockRejectedValueOnce(new Error("routine was dropped"));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "새로고침" })); });
  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).toContain("routine was dropped");
  vi.mocked(ipc.metadataGetRoutineDefinition).mockResolvedValueOnce(functionSql.replace("SELECT $1", "SELECT $1 + 1"));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "다시 시도" })); });
  await waitFor(() => expect(code().value).toContain("SELECT $1 + 1"));
  vi.mocked(ipc.metadataGetRoutineDefinition).mockResolvedValueOnce(procedureSql);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Open procedure" })); });
  await waitFor(() => expect(code().value).toBe(procedureSql));
  expect(workspaceStates.get("A")!.tabs).toHaveLength(3);
  expect(ipc.queryExecute).not.toHaveBeenCalled();
  expect(ipc.tableDataExecute).not.toHaveBeenCalled();
  vi.mocked(ipc.connectionSwitchDatabase).mockResolvedValueOnce({ connectionId: "A", profileId: "A", database: "analytics", serverVersion: "17" });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Open analytics DB" })); });
  expect(screen.queryByLabelText("정의 SQL")).toBeNull();
  expect(workspaceStates.get("A")!.tabs.every((t) => t.kind === "query")).toBe(true);
  expect(testRouter.state.location.pathname).toBe("/workspace/A");
});

it("changes DB in the same connection, clears stale results and restores database-specific drafts", async () => {
  vi.mocked(ipc.connectionSwitchDatabase).mockImplementation(async ({ connectionId, database }) => ({
    connectionId, profileId: "A", database, serverVersion: "17",
  }));
  vi.mocked(restoreWorkspace).mockImplementation((_id, database) => {
    if (database !== "db") return undefined;
    sqlDrafts.set("restored-default", "SELECT 'default DB draft'");
    return { ...emptyWorkspace(), tabs: [{ id: "restored-default", title: "Restored draft", kind: "query", resultTabs: [] }], activeTabId: "restored-default" };
  });
  dispatchWorkspace("A", { type: "RESULT_ADDED", tabId: "A-tab", resultTabId: "db-switch-dirty" });
  editStore.setCell("db-switch-dirty", 0, "name", { value: "unsaved edit" });
  const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValue(true);
  const testRouter = await mountWorkspace();
  client!.setQueryDefaults(["objects"], { gcTime: Infinity });
  client!.setQueryDefaults(["schemas"], { gcTime: Infinity });
  client!.setQueryData(["objects", "A", 1, "table"], ["old database table"]);
  client!.setQueryData(["schemas", "B", false], ["other connection schema"]);
  fireEvent.change(editor(), { target: { value: "SELECT 'default DB draft'" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Open analytics DB" })); });
  expect(confirm).toHaveBeenCalled();
  expect(ipc.connectionSwitchDatabase).not.toHaveBeenCalled();
  expect(editStore.getSnapshot("db-switch-dirty").pendingCount).toBe(1);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Open analytics DB" })); });
  await waitFor(() => expect(openConnections.get("A")?.database).toBe("analytics"));
  expect(ipc.connectionSwitchDatabase).toHaveBeenLastCalledWith({ connectionId: "A", database: "analytics" });
  expect(openConnections.entries()).toHaveLength(2); // A and the unrelated B; no new item.
  expect(openConnections.get("B")?.database).toBe("db");
  expect(testRouter.state.location.pathname).toBe("/workspace/A");
  expect(editor().value).toBe("");
  expect(editStore.getSnapshot("db-switch-dirty").pendingCount).toBe(0);
  expect(client!.getQueryData(["objects", "A", 1, "table"])).toBeUndefined();
  expect(client!.getQueryData(["schemas", "B", false])).toEqual(["other connection schema"]);
  expect(vi.mocked(saveWorkspaceNow).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(ipc.connectionSwitchDatabase).mock.invocationCallOrder[0]);
  expect(ipc.connectionClose).not.toHaveBeenCalled();
  expect(ipc.querySessionClose).not.toHaveBeenCalled();
  fireEvent.change(editor(), { target: { value: "SELECT 'analytics'" } });
  await act(async () => { fireEvent.click(runButton()); });
  expect(ipc.queryExecute).toHaveBeenCalledWith(expect.objectContaining({ connectionId: "A", sql: "SELECT 'analytics'" }), expect.anything());
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Open default DB" })); });
  await waitFor(() => expect(editor().value).toBe("SELECT 'default DB draft'"));
  expect(openConnections.get("A")?.database).toBe("db");
  vi.mocked(ipc.connectionSwitchDatabase).mockRejectedValueOnce(new Error("permission denied"));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Open analytics DB" })); });
  await screen.findByText("permission denied");
  expect(editor().value).toBe("SELECT 'default DB draft'");
  expect(ipc.resultRelease).not.toHaveBeenCalled();
});

it("blocks database switching during a query, transaction or failed draft save", async () => {
  await mountWorkspace();
  for (const busy of [{ runningExecutionId: "running" }, { transactionState: "in-transaction" as const }]) {
    Object.assign(tab(), busy);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Open analytics DB" })); });
    expect(screen.getByText(/열린 트랜잭션을 종료한 후 DB/)).toBeTruthy();
    expect(ipc.connectionSwitchDatabase).not.toHaveBeenCalled();
    tab().runningExecutionId = undefined; tab().transactionState = "idle";
  }
  vi.mocked(saveWorkspaceNow).mockRejectedValueOnce(new Error("disk full"));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Open analytics DB" })); });
  await screen.findByText("disk full");
  expect(ipc.connectionSwitchDatabase).not.toHaveBeenCalled();
  expect(openConnections.get("A")?.database).toBe("db");
  expect(editor().value).toBe("SELECT 'A'");
});

it("leaves Run enabled when Channel completion precedes the invoke response", async () => {
  await mountWorkspace();
  await act(async () => { fireEvent.click(runButton()); });
  // A saved profile's legacy 500-row limit must not stop infinite scrolling.
  expect(ipc.queryExecute).toHaveBeenCalledWith(expect.objectContaining({ maxRows: 0 }), expect.anything());
  expect(runButton().disabled).toBe(false);
  expect(tab().runningExecutionId).toBeUndefined();
  expect(tab().resultTabs[0].isRunning).toBe(false);
  expect(resultStore.getSnapshot(tab().activeResultTabId!).status).toBe("completed");
  expect(historyStore.list()).toHaveLength(1);
});

it("resizes the editor/results split with pointer and keyboard without resetting SQL or results", async () => {
  await mountWorkspace();
  fireEvent.change(editor(), { target: { value: "SELECT 'keep draft'" } });
  await act(async () => { fireEvent.click(runButton()); });
  const resultTabId = tab().activeResultTabId;
  const separator = screen.getByRole("separator", { name: "에디터와 Result 영역 높이 조절" });
  const resultPane = separator.nextElementSibling as HTMLElement;
  vi.spyOn(separator.parentElement!, "getBoundingClientRect").mockReturnValue({ height: 606 } as DOMRect);
  vi.spyOn(separator, "getBoundingClientRect").mockReturnValue({ height: 6 } as DOMRect);
  separator.setPointerCapture = vi.fn();
  separator.hasPointerCapture = vi.fn().mockReturnValue(true);
  const pointer = (type: string, y: number) => fireEvent(separator, Object.assign(new Event(type, { bubbles: true }), {
    pointerId: 1, button: 0, clientY: y,
  }));
  expect(separator.getAttribute("aria-valuenow")).toBe("40");
  pointer("pointerdown", 340);
  expect(separator.setPointerCapture).toHaveBeenCalledWith(1);
  pointer("pointermove", 220);
  expect(separator.getAttribute("aria-valuenow")).toBe("20");
  expect(resultPane.style.flexGrow).toBe("80");
  pointer("pointermove", -1000);
  expect(separator.getAttribute("aria-valuenow")).toBe("20");
  pointer("pointermove", 2000);
  expect(separator.getAttribute("aria-valuenow")).toBe("80");
  expect(resultPane.style.flexGrow).toBe("20");
  pointer("pointerup", 2000);
  pointer("pointermove", 220);
  expect(separator.getAttribute("aria-valuenow")).toBe("80");
  fireEvent.keyDown(separator, { key: "ArrowUp" });
  expect(separator.getAttribute("aria-valuenow")).toBe("75");
  pointer("pointerdown", 340);
  pointer("pointercancel", 340);
  pointer("pointermove", 100);
  expect(separator.getAttribute("aria-valuenow")).toBe("75");
  fireEvent.doubleClick(separator);
  expect(separator.getAttribute("aria-valuenow")).toBe("40");
  fireEvent.keyDown(separator, { key: "Home" });
  expect(separator.getAttribute("aria-valuenow")).toBe("20");
  fireEvent.keyDown(separator, { key: "End" });
  expect(separator.getAttribute("aria-valuenow")).toBe("80");
  expect(editor().value).toBe("SELECT 'keep draft'");
  expect(tab().activeResultTabId).toBe(resultTabId);
  expect(resultStore.getSnapshot(resultTabId!).rows).toEqual([[{ kind: "integer", value: "2" }]]);
  await act(async () => { fireEvent.click(runButton()); });
  expect(separator.getAttribute("aria-valuenow")).toBe("80");
  expect(tab().activeResultTabId).toBe(resultTabId);
});

it("applies background completion to the original workspace after a route switch", async () => {
  let channel!: Channel<QueryStreamEvent>;
  vi.mocked(ipc.queryExecute).mockImplementation(async (_request, incoming) => { channel = incoming; return { executionId: "background", sessionId: "A-session" }; });
  const testRouter = await mountWorkspace();
  await act(async () => { fireEvent.click(runButton()); });
  expect(runButton().disabled).toBe(true);
  await act(async () => { await testRouter.navigate({ to: "/workspace/$connectionId", params: { connectionId: "B" } }); });
  const untouched = workspaceStates.get("B");
  await act(async () => { complete(channel, "background"); });
  expect(tab("A").runningExecutionId).toBeUndefined();
  expect(tab("A").resultTabs[0].isRunning).toBe(false);
  expect(workspaceStates.get("B")).toBe(untouched);
  expect(runButton().disabled).toBe(false);
  await act(async () => { await testRouter.navigate({ to: "/workspace/$connectionId", params: { connectionId: "A" } }); });
  expect(runButton().disabled).toBe(false);
  expect(tab("A").sessionId).toBe("A-session");
});

it("does not create a second execution while invoke acceptance is pending", async () => {
  let resolve!: (value: ExecutionAccepted) => void;
  let channel!: Channel<QueryStreamEvent>;
  vi.mocked(ipc.queryExecute).mockImplementation((_request, incoming) => {
    channel = incoming;
    return new Promise((done) => { resolve = done; });
  });
  await mountWorkspace();
  await act(async () => { fireEvent.click(runButton()); });
  expect(runButton().disabled).toBe(true);
  await act(async () => { fireEvent.click(runButton()); });
  expect(ipc.queryExecute).toHaveBeenCalledTimes(1);
  expect(tab().resultTabs).toHaveLength(1);
  await act(async () => { complete(channel, "pending"); resolve({ executionId: "pending", sessionId: "session" }); });
  expect(runButton().disabled).toBe(false);
});

it("runs into a fresh result when the active result has unsaved edits", async () => {
  dispatchWorkspace("A", { type: "RESULT_ADDED", tabId: "A-tab", resultTabId: "dirty-result" });
  resultStore.create("dirty-result", "SELECT 1");
  resultStore.pushRows("dirty-result", [[{ kind: "integer", value: "1" }]]);
  resultStore.setTerminal("dirty-result", { status: "completed" });
  editStore.setCell("dirty-result", 0, "name", { value: "edited first row" });
  await mountWorkspace();
  await act(async () => { fireEvent.click(runButton()); });
  expect(tab().resultTabs).toHaveLength(2);
  const freshResult = tab().activeResultTabId!;
  expect(freshResult).not.toBe("dirty-result");
  expect(resultStore.getSnapshot("dirty-result").rows).toEqual([[{ kind: "integer", value: "1" }]]);
  expect(editStore.getSnapshot("dirty-result").updates.get(0)?.get("name")?.value).toBe("edited first row");
  expect(resultStore.getSnapshot(freshResult).rows).toEqual([[{ kind: "integer", value: "2" }]]);
  await act(async () => { fireEvent.click(runButton()); });
  expect(tab().resultTabs).toHaveLength(2);
  expect(tab().activeResultTabId).toBe(freshResult);
});

it("starts a newly opened Table Data tab on page one and restores each tab's own page", async () => {
  await mountWorkspace();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Open alpha" })); });
  await waitFor(() => expect(ipc.tableDataExecute).toHaveBeenCalledTimes(1));
  const alphaTabId = workspaceStates.get("A")!.activeTabId!;
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "다음 페이지" })); });
  expect(vi.mocked(ipc.tableDataExecute).mock.calls[1][0]).toMatchObject({ relationOid: 100, offset: 200 });
  expect(screen.getByText("201–400행")).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Open beta" })); });
  await waitFor(() => expect(ipc.tableDataExecute).toHaveBeenCalledTimes(3));
  const betaTabId = workspaceStates.get("A")!.activeTabId!;
  expect(vi.mocked(ipc.tableDataExecute).mock.calls[2][0]).toMatchObject({ relationOid: 101, offset: 0 });
  expect(screen.getByText("1–200행")).toBeTruthy();
  expect(tableDataViews.get(alphaTabId)?.offset).toBe(200);
  expect(tableDataViews.get(betaTabId)?.offset).toBe(0);
  await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "alpha" })); });
  expect(screen.getByText("201–400행")).toBeTruthy();
  expect(ipc.tableDataExecute).toHaveBeenCalledTimes(3);
});
