import type { Channel } from "@tauri-apps/api/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { historyStore } from "../../entities/query/historyStore";
import { resultStore } from "../../entities/result/resultStore";
import { dispatchWorkspace, emptyWorkspace, workspaceStates } from "../../entities/workspace/workspaceStore";
import type { ExecutionAccepted, QueryExecuteRequest, QueryStreamEvent } from "../../generated/ipc-types";
import { ipc } from "./invoke";
import { loadMoreRows, runQuery, runTableData } from "./queryChannel";

vi.mock("@tauri-apps/api/core", () => ({ Channel: class<T> { onmessage: (event: T) => void = () => undefined; } }));
vi.mock("./invoke", () => ({ ipc: { queryExecute: vi.fn(), tableDataExecute: vi.fn(), queryAckChunk: vi.fn(), resultRowsFetch: vi.fn() } }));

const request: QueryExecuteRequest = { connectionId: "A", queryTabId: "A-tab", resultTabId: "A-result", sql: "SELECT 1", maxRows: 100, timeoutMs: 1000 };
const accepted: ExecutionAccepted = { executionId: "execution", sessionId: "session" };
const completed: QueryStreamEvent = { type: "completed", executionId: accepted.executionId, rowCount: 1, truncated: false, durationMs: 2, transactionState: "idle" };
const currentTab = () => workspaceStates.get("A")!.tabs[0];

function pendingInvoke() {
  let resolve!: (value: ExecutionAccepted) => void;
  const response = new Promise<ExecutionAccepted>((done) => { resolve = done; });
  let channel!: Channel<QueryStreamEvent>;
  vi.mocked(ipc.queryExecute).mockImplementation((_request, ch) => { channel = ch; return response; });
  return { resolve, channel: () => channel };
}

beforeEach(() => {
  vi.resetAllMocks();
  historyStore.clear();
  workspaceStates.clear();
  for (const id of ["A", "B"]) {
    workspaceStates.set(id, emptyWorkspace());
    dispatchWorkspace(id, { type: "TAB_ADDED", tabId: `${id}-tab` });
    dispatchWorkspace(id, { type: "RESULT_ADDED", tabId: `${id}-tab`, resultTabId: `${id}-result` });
  }
  vi.mocked(ipc.queryAckChunk).mockResolvedValue(undefined);
});
afterEach(() => {
  for (const id of ["A-result", "B-result", "second-result", "A-tab:data"]) resultStore.dispose(id);
  workspaceStates.clear();
  historyStore.clear();
});

it.each<Extract<QueryStreamEvent, { type: "completed" | "failed" | "cancelled" }>>([
  completed,
  { type: "failed", executionId: accepted.executionId, error: { code: "QUERY_ERROR", message: "bad SQL", retryable: false, sqlState: "42601", position: null, detail: null, hint: null }, durationMs: 2, transactionState: "failed-transaction" },
  { type: "cancelled", executionId: accepted.executionId, receivedRowCount: 0, durationMs: 2, transactionState: "idle" },
])("does not restart a $type execution when its invoke response arrives late", async (terminal) => {
  const pending = pendingInvoke();
  const running = runQuery(request);
  expect(currentTab().runningExecutionId).toMatch(/^pending:/);
  pending.channel().onmessage({ type: "started", executionId: accepted.executionId, backendPid: 123, startedAt: "2026-09-07T00:00:00Z" });
  pending.channel().onmessage(terminal);
  expect(currentTab().runningExecutionId).toBeUndefined();
  expect(currentTab().resultTabs[0].isRunning).toBe(false);
  pending.resolve(accepted);
  await expect(running).resolves.toEqual(accepted);
  expect(currentTab()).toMatchObject({ sessionId: accepted.sessionId, runningExecutionId: undefined, transactionState: terminal.transactionState });
  expect(resultStore.getSnapshot(request.resultTabId).status).toBe(terminal.type);
  expect(historyStore.list()).toHaveLength(1);
  expect(historyStore.list()[0]).toMatchObject({ connectionId: "A", sql: request.sql, status: terminal.type });
});

it("refuses a second execution on the same tab while invoke is pending", async () => {
  const pending = pendingInvoke();
  const running = runQuery(request);
  await expect(runQuery({ ...request, resultTabId: "second-result" })).rejects.toThrow("이미 쿼리를 실행 중");
  expect(ipc.queryExecute).toHaveBeenCalledTimes(1);
  expect(resultStore.getSnapshot("second-result").status).toBe("idle");
  pending.channel().onmessage(completed);
  pending.resolve(accepted);
  await running;
});

it("clears the owning workspace on invoke failure and leaves other connections unchanged", async () => {
  const otherWorkspace = workspaceStates.get("B");
  vi.mocked(ipc.queryExecute).mockRejectedValue(new Error("connection lost"));
  await expect(runQuery(request)).rejects.toThrow("connection lost");
  expect(currentTab().runningExecutionId).toBeUndefined();
  expect(currentTab().resultTabs[0].isRunning).toBe(false);
  expect(resultStore.getSnapshot(request.resultTabId)).toMatchObject({ status: "failed", error: { message: "connection lost" } });
  expect(workspaceStates.get("B")).toBe(otherWorkspace);
});

it("acks stale chunks without writing them into a replacement result", async () => {
  const channels: Channel<QueryStreamEvent>[] = [];
  vi.mocked(ipc.queryExecute).mockImplementation(async (_request, channel) => { channels.push(channel); return accepted; });
  await runQuery(request);
  channels[0].onmessage(completed);
  await runQuery({ ...request, sql: "SELECT 2" });
  channels[0].onmessage({ type: "rows", executionId: "old", sequence: 0, rows: [[{ kind: "integer", value: "999" }]] });
  expect(resultStore.getSnapshot(request.resultTabId).rows).toEqual([]);
  expect(ipc.queryAckChunk).toHaveBeenCalledWith({ executionId: "old", sequence: 0 });
  channels[1].onmessage({ type: "rows", executionId: accepted.executionId, sequence: 0, rows: [[{ kind: "integer", value: "2" }]] });
  channels[1].onmessage(completed);
  expect(resultStore.getSnapshot(request.resultTabId).rows).toEqual([[{ kind: "integer", value: "2" }]]);
  expect(currentTab().runningExecutionId).toBeUndefined();
});

it("uses the same early-completion lifecycle for Table Data without recording SQL history", async () => {
  vi.mocked(ipc.tableDataExecute).mockImplementation(async (_request, channel) => { channel.onmessage(completed); return accepted; });
  await runTableData({ connectionId: "A", queryTabId: "A-tab", resultTabId: "A-tab:data", relationOid: 42, sortAttribute: null, sortDescending: false, limit: 200, offset: 0 });
  expect(currentTab().runningExecutionId).toBeUndefined();
  expect(currentTab().sessionId).toBe(accepted.sessionId);
  expect(resultStore.getSnapshot("A-tab:data").status).toBe("completed");
  expect(historyStore.list()).toEqual([]);
});

it("ignores page responses for replaced results and keeps the fetch offset after a row is deleted", async () => {
  const prepare = () => {
    resultStore.dispose("A-result");
    resultStore.create("A-result", "SELECT 1", true);
    resultStore.setStarted("A-result", "old-execution");
    resultStore.appendRows("A-result", 0, [[{ kind: "integer", value: "1" }], [{ kind: "integer", value: "2" }]]);
    resultStore.setTerminal("A-result", { status: "completed", rowCount: 4 });
  };
  prepare();
  let finish!: (page: import("../../generated/ipc-types").ResultRowsFetchResponse) => void;
  vi.mocked(ipc.resultRowsFetch).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const pending = loadMoreRows("A-result");
  prepare();
  finish({ rows: [[{ kind: "integer", value: "999" }]], nextOffset: 3, hasMore: true });
  await pending;
  expect(resultStore.getSnapshot("A-result").rows).toHaveLength(2);
  resultStore.removeRows("A-result", [0]);
  vi.mocked(ipc.resultRowsFetch).mockResolvedValueOnce({ rows: [[{ kind: "integer", value: "3" }], [{ kind: "integer", value: "4" }]], nextOffset: 4, hasMore: false });
  await loadMoreRows("A-result");
  expect(ipc.resultRowsFetch).toHaveBeenLastCalledWith({ resultTabId: "A-result", executionId: "old-execution", offset: 2 });
  expect(resultStore.getSnapshot("A-result").rows.map((row) => row[0])).toEqual([2, 3, 4].map((n) => ({ kind: "integer", value: String(n) })));
  expect(resultStore.getSnapshot("A-result").rowCount).toBe(3);
  expect(ipc.queryExecute).not.toHaveBeenCalled();
});
