import { Channel } from "@tauri-apps/api/core";
import { historyStore } from "../../entities/query/historyStore";
import { dispatchWorkspace, workspaceStates } from "../../entities/workspace/workspaceStore";
import { resultStore } from "../../entities/result/resultStore";
import type {
  ExecutionAccepted,
  QueryExecuteRequest,
  QueryStreamEvent,
  TableDataExecuteRequest,
} from "../../generated/ipc-types";
import { ipc } from "./invoke";

/**
 * Wires a per-execution Tauri Channel into the ResultStore and acks every
 * rows chunk once it has landed (max 2 unacked on the Rust side).
 */
function resultChannel(resultTabId: string, onEvent: (event: QueryStreamEvent) => void, isCurrent: () => boolean): Channel<QueryStreamEvent> {
  const tab = resultTabId;
  const channel = new Channel<QueryStreamEvent>();
  channel.onmessage = (event) => {
    const ack = () => { if (event.type === "rows") void ipc.queryAckChunk({ executionId: event.executionId, sequence: event.sequence }).catch(() => undefined); };
    if (!isCurrent()) { ack(); return; }
    switch (event.type) {
      case "started":
        resultStore.setStarted(tab, event.executionId);
        break;
      case "columns":
        resultStore.setColumns(tab, event.columns);
        break;
      case "rows":
        if (!resultStore.appendRows(tab, event.sequence, event.rows)) {
          void ipc.queryCancel({ executionId: event.executionId }).catch(() => undefined);
        }
        ack();
        break;
      case "notice":
        break; // surfaced in a later milestone
      case "command":
        resultStore.setCommand(tab, event.commandTag, event.affectedRows);
        break;
      case "completed":
        resultStore.setTerminal(tab, {
          status: "completed",
          rowCount: event.rowCount,
          truncated: event.truncated,
          durationMs: event.durationMs,
          transactionState: event.transactionState,
        });
        break;
      case "failed":
        resultStore.setTerminal(tab, {
          status: "failed",
          error: event.error,
          durationMs: event.durationMs,
          transactionState: event.transactionState,
        });
        break;
      case "cancelled":
        resultStore.setTerminal(tab, {
          status: "cancelled",
          rowCount: event.receivedRowCount,
          durationMs: event.durationMs,
          transactionState: event.transactionState,
        });
        break;
    }
    onEvent(event);
  };
  return channel;
}

async function start(
  request: Pick<QueryExecuteRequest, "connectionId" | "queryTabId" | "resultTabId">,
  invokeFn: (channel: Channel<QueryStreamEvent>) => Promise<ExecutionAccepted>,
  executedSql?: string,
): Promise<ExecutionAccepted> {
  const { connectionId, queryTabId: tabId, resultTabId } = request;
  const tab = workspaceStates.get(connectionId)?.tabs.find((t) => t.id === tabId);
  if (tab?.runningExecutionId) throw new Error("이 탭에서 이미 쿼리를 실행 중입니다.");
  resultStore.create(resultTabId, executedSql, executedSql !== undefined);
  const rows = resultStore.getSnapshot(resultTabId).rows;
  const isCurrent = () => resultStore.getSnapshot(resultTabId).rows === rows;
  const dispatch = (action: Parameters<typeof dispatchWorkspace>[1]) => dispatchWorkspace(connectionId, action);
  dispatch({ type: "EXECUTION_STARTED", tabId, resultTabId, executionId: `pending:${resultTabId}` });
  const startedAt = new Date().toISOString();
  let terminal = false;
  const finish = () => {
    if (terminal) return;
    terminal = true;
    const s = resultStore.getSnapshot(resultTabId);
    dispatch({ type: "EXECUTION_ENDED", tabId, resultTabId, transactionState: s.transactionState });
    if (executedSql && (s.status === "completed" || s.status === "failed" || s.status === "cancelled")) {
      historyStore.record({ connectionId, sql: executedSql, startedAt, durationMs: s.durationMs, status: s.status });
    }
  };
  try {
    const accepted = await invokeFn(resultChannel(resultTabId, (event) => {
      if (event.type === "started") {
        dispatch({ type: "EXECUTION_STARTED", tabId, resultTabId, executionId: event.executionId });
      } else if (event.type === "completed" || event.type === "failed" || event.type === "cancelled") finish();
    }, isCurrent));
    dispatch({ type: "SESSION_OPENED", tabId, sessionId: accepted.sessionId });
    if (!terminal && isCurrent()) {
      dispatch({ type: "EXECUTION_STARTED", tabId, resultTabId, ...accepted });
    }
    return accepted;
  } catch (err) {
    if (isCurrent() && !terminal) {
      const e = err as Partial<import("../../generated/ipc-types").AppError>;
      resultStore.setTerminal(resultTabId, { status: "failed", error: {
        code: e?.code ?? "QUERY_FAILED", message: e?.message ?? String(err), retryable: false,
        sqlState: e?.sqlState ?? null, position: e?.position ?? null, detail: null, hint: null,
      } });
      finish();
    }
    throw err;
  }
}

export function runQuery(request: QueryExecuteRequest): Promise<ExecutionAccepted> {
  return start(request, (ch) => ipc.queryExecute(request, ch), request.sql);
}

export function runTableData(request: TableDataExecuteRequest): Promise<ExecutionAccepted> {
  return start(request, (ch) => ipc.tableDataExecute(request, ch));
}

export async function loadMoreRows(resultTabId: string): Promise<void> {
  const current = resultStore.getSnapshot(resultTabId);
  if (!current.hasMoreRows || current.loadingMore || !current.executionId) return;
  const offset = current.nextRowOffset ?? 0;
  const isCurrent = () => resultStore.getSnapshot(resultTabId).rows === current.rows;
  resultStore.setPageLoading(resultTabId, true);
  try {
    const page = await ipc.resultRowsFetch({ resultTabId, executionId: current.executionId, offset });
    if (!isCurrent()) return;
    if (page.nextOffset !== offset + page.rows.length || (page.hasMore && page.rows.length === 0)) throw new Error("결과 페이지의 행 순서가 올바르지 않습니다.");
    resultStore.appendPage(resultTabId, page);
  } catch (error) {
    if (isCurrent()) resultStore.setPageLoading(resultTabId, false, (error as Error).message ?? String(error));
  }
}
