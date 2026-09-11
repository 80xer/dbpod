import { Channel } from "@tauri-apps/api/core";
import type { EditSnapshot } from "../../entities/result/editStore";
import { editStore } from "../../entities/result/editStore";
import type { ResultSnapshot } from "../../entities/result/resultStore";
import { resultStore } from "../../entities/result/resultStore";
import type {
  ChangesCommitEvent,
  DbValue,
  InsertCellDraft,
  RowChange,
  RowConflict,
  RowIdentity,
  UpdatedRow,
} from "../../generated/ipc-types";
import { ipc } from "../../shared/ipc/invoke";
import type { EditableInfo } from "./editability";

function textOf(v: DbValue | undefined): string | null {
  if (!v || v.kind === "null") return null;
  if (v.kind === "boolean") return v.value ? "true" : "false";
  if (v.kind === "binary" || v.kind === "array") return null;
  return v.value;
}

function draftValue(value: string | null): DbValue {
  return value === null ? { kind: "null" } : { kind: "text", value };
}

export function buildRowChanges(
  info: EditableInfo,
  result: ResultSnapshot,
  edits: EditSnapshot,
): RowChange[] {
  const changes: RowChange[] = [];

  const identityFor = (rowIndex: number): RowIdentity => {
    const row = result.rows[rowIndex];
    return {
      relationOid: info.relationOid,
      primaryKey: info.pk.map((p) => ({
        attributeNumber: p.attributeNumber,
        columnName: p.columnName,
        value: row[p.columnIndex],
      })),
      xmin:
        info.xminColumnIndex !== undefined
          ? (textOf(row[info.xminColumnIndex]) ?? null)
          : null,
    };
  };

  const originalsFor = (rowIndex: number): Record<string, DbValue> => {
    if (info.lockMode === "xmin") return {};
    const row = result.rows[rowIndex];
    const out: Record<string, DbValue> = {};
    for (const col of result.columns) {
      const catalog = info.catalogName[col.name];
      if (!catalog) continue;
      const v = row[col.index];
      if (v && v.kind !== "binary" && v.kind !== "array") out[catalog] = v;
    }
    return out;
  };

  for (const rowIndex of edits.deletes) {
    changes.push({ operation: "delete", rowId: `d:${rowIndex}`, identity: identityFor(rowIndex), originalValues: originalsFor(rowIndex) });
  }
  for (const [rowIndex, cells] of edits.updates) {
    if (edits.deletes.has(rowIndex)) continue; // delete wins
    const changed: Record<string, DbValue> = {};
    for (const [displayName, draft] of cells) {
      const catalog = info.catalogName[displayName] ?? displayName;
      changed[catalog] = draftValue(draft.value);
    }
    changes.push({
      operation: "update",
      rowId: `u:${rowIndex}`,
      identity: identityFor(rowIndex),
      originalValues: originalsFor(rowIndex),
      changes: changed,
    });
  }
  for (const insert of edits.inserts) {
    const values: Record<string, InsertCellDraft> = {};
    for (const [displayName, cell] of Object.entries(insert.cells)) {
      const catalog = info.catalogName[displayName] ?? displayName;
      values[catalog] =
        cell.mode === "value"
          ? { mode: "value", value: { kind: "text", value: cell.value } }
          : cell.mode === "null"
            ? { mode: "null" }
            : { mode: "default" };
    }
    changes.push({ operation: "insert", rowId: `i:${insert.draftId}`, values });
  }
  return changes;
}

export type CommitOutcome =
  | { type: "completed"; rowCount: number }
  | { type: "conflict"; conflicts: RowConflict[] }
  | { type: "failed"; message: string };

/** Streams the commit and applies authoritative server values to the grid. */
export async function commitChangeSet(
  resultTabId: string,
  changeSetId: string,
  info: EditableInfo,
): Promise<CommitOutcome> {
  const originalRows = resultStore.getSnapshot(resultTabId).rows;
  editStore.setLocked(resultTabId, true);
  try {
  const outcome = await new Promise<CommitOutcome>((resolve, reject) => {
    let terminal = false;
    const channel = new Channel<ChangesCommitEvent>();
    channel.onmessage = (event) => {
      if (terminal) return;
      if (event.type !== "started" && event.type !== "progress") terminal = true;
      switch (event.type) {
        case "started":
        case "progress":
          break;
        case "completed":
          if (resultStore.getSnapshot(resultTabId).rows === originalRows) applyUpdatedRows(resultTabId, event.rows, info);
          resolve({ type: "completed", rowCount: event.rows.length });
          break;
        case "conflict":
          resolve({ type: "conflict", conflicts: event.conflicts });
          break;
        case "failed":
          resolve({
            type: "failed",
            message: `${event.error.message}${event.error.sqlState ? ` (SQLSTATE ${event.error.sqlState})` : ""}`,
          });
          break;
      }
    };
    void ipc.changesCommit({ changeSetId }, channel).then(() => {
      if (!terminal) reject(new Error("저장 결과를 확인하지 못했습니다. 재시도 전에 DB 상태를 확인하세요."));
    }).catch(reject);
  });
  if (outcome.type === "completed") editStore.clear(resultTabId);
  return outcome;
  } finally { editStore.setLocked(resultTabId, false); }
}

function serverRowToGridRow(
  columns: ResultSnapshot["columns"],
  info: EditableInfo,
  updated: UpdatedRow,
  fallback?: DbValue[],
): DbValue[] {
  return columns.map((col) => {
    if (col.name === "__dbpod_xmin")
      return updated.xmin != null
        ? ({ kind: "text", value: updated.xmin } as DbValue)
        : (fallback?.[col.index] ?? { kind: "null" });
    const catalog = info.catalogName[col.name] ?? col.name;
    return updated.values[catalog] ?? fallback?.[col.index] ?? { kind: "null" };
  });
}

function applyUpdatedRows(resultTabId: string, rows: UpdatedRow[], info: EditableInfo): void {
  const snapshot = resultStore.getSnapshot(resultTabId);
  const deleted: number[] = [];
  const inserted: DbValue[][] = [];
  for (const r of rows) {
    if (r.rowId.startsWith("u:")) {
      const idx = Number(r.rowId.slice(2));
      resultStore.replaceRow(
        resultTabId,
        idx,
        serverRowToGridRow(snapshot.columns, info, r, snapshot.rows[idx]),
      );
    } else if (r.rowId.startsWith("d:")) {
      deleted.push(Number(r.rowId.slice(2)));
    } else if (r.rowId.startsWith("i:")) {
      inserted.push(serverRowToGridRow(snapshot.columns, info, r));
    }
  }
  if (deleted.length > 0) resultStore.removeRows(resultTabId, deleted);
  if (inserted.length > 0) resultStore.pushRows(resultTabId, inserted);
}

/** Conflict resolution: overwrite local rows with the latest server values. */
export function applyServerValues(
  resultTabId: string,
  conflicts: RowConflict[],
  info: EditableInfo,
): void {
  const snapshot = resultStore.getSnapshot(resultTabId);
  const resolved: number[] = [];
  const removed: number[] = [];
  for (const c of conflicts) {
    const idx = c.rowId.startsWith("u:") || c.rowId.startsWith("d:") ? Number(c.rowId.slice(2)) : NaN;
    if (!Number.isSafeInteger(idx) || idx < 0 || idx >= snapshot.rows.length) continue;
    resolved.push(idx);
    if (c.current) {
      resultStore.replaceRow(resultTabId, idx, serverRowToGridRow(snapshot.columns, info, {
        rowId: c.rowId, operation: "current", values: c.current, xmin: textOf(c.current.__dbpod_xmin),
      }, snapshot.rows[idx]));
    } else removed.push(idx);
  }
  // Resolve in the original coordinate system, then compact both stores once.
  editStore.resolveRows(resultTabId, resolved, removed);
  resultStore.removeRows(resultTabId, removed);
}
