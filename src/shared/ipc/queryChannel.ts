import { Channel } from "@tauri-apps/api/core";
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
function resultChannel(resultTabId: string): Channel<QueryStreamEvent> {
  const tab = resultTabId;
  const channel = new Channel<QueryStreamEvent>();
  channel.onmessage = (event) => {
    switch (event.type) {
      case "started":
        resultStore.setStarted(tab, event.executionId);
        break;
      case "columns":
        resultStore.setColumns(tab, event.columns);
        break;
      case "rows":
        resultStore.appendRows(tab, event.sequence, event.rows);
        void ipc.queryAckChunk({ executionId: event.executionId, sequence: event.sequence });
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
  };
  return channel;
}

async function start(
  resultTabId: string,
  invokeFn: (channel: Channel<QueryStreamEvent>) => Promise<ExecutionAccepted>,
): Promise<ExecutionAccepted> {
  resultStore.create(resultTabId);
  try {
    return await invokeFn(resultChannel(resultTabId));
  } catch (err) {
    resultStore.setTerminal(resultTabId, { status: "failed", error: err as never });
    throw err;
  }
}

export function runQuery(request: QueryExecuteRequest): Promise<ExecutionAccepted> {
  return start(request.resultTabId, (ch) => ipc.queryExecute(request, ch));
}

export function runTableData(request: TableDataExecuteRequest): Promise<ExecutionAccepted> {
  return start(request.resultTabId, (ch) => ipc.tableDataExecute(request, ch));
}
