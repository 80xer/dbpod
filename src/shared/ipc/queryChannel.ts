import { Channel } from "@tauri-apps/api/core";
import { resultStore } from "../../entities/result/resultStore";
import type {
  ExecutionAccepted,
  QueryExecuteRequest,
  QueryStreamEvent,
} from "../../generated/ipc-types";
import { ipc } from "./invoke";

/**
 * Runs one execution: wires the Tauri Channel into the ResultStore and
 * acks every rows chunk once it has landed (max 2 unacked on the Rust side).
 */
export async function runQuery(request: QueryExecuteRequest): Promise<ExecutionAccepted> {
  const tab = request.resultTabId;
  resultStore.create(tab);

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
        break; // surfaced in Milestone B
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

  try {
    return await ipc.queryExecute(request, channel);
  } catch (err) {
    resultStore.setTerminal(tab, {
      status: "failed",
      error: err as never,
    });
    throw err;
  }
}
