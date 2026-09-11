import type {
  AppError,
  ColumnMeta,
  DbValue,
  TransactionState,
} from "../../generated/ipc-types";
import { editStore } from "./editStore";

export type ResultStatus = "idle" | "running" | "completed" | "failed" | "cancelled";

export type ResultSnapshot = {
  executionId?: string;
  executedSql?: string;
  columns: ColumnMeta[];
  /** Mutated in place; the snapshot object identity changes on every update. */
  rows: DbValue[][];
  status: ResultStatus;
  error?: AppError;
  rowCount?: number;
  truncated?: boolean;
  durationMs?: number;
  transactionState?: TransactionState;
  commandTag?: string;
  affectedRows?: number | null;
  protocolError?: boolean;
  pageable?: boolean;
  nextRowOffset?: number;
  hasMoreRows?: boolean;
  loadingMore?: boolean;
  pageError?: string;
};

const EMPTY: ResultSnapshot = { columns: [], rows: [], status: "idle" };

/**
 * Per-result-tab row store living outside the React tree. Rows are appended
 * in place (never copied into React state); components subscribe via
 * useSyncExternalStore and re-render on snapshot identity change.
 */
class ResultStore {
  private states = new Map<string, ResultSnapshot>();
  private nextSequence = new Map<string, number>();
  private listeners = new Map<string, Set<() => void>>();

  create(resultTabId: string, executedSql?: string, pageable = false): void {
    const edits = editStore.getSnapshot(resultTabId);
    if (edits.pendingCount || edits.locked) throw new Error("저장하지 않은 변경이 있는 결과는 교체할 수 없습니다.");
    if (this.states.get(resultTabId)?.status === "running") throw new Error("이미 실행 중인 결과입니다.");
    this.states.set(resultTabId, { columns: [], rows: [], status: "running", executedSql, pageable, nextRowOffset: 0 });
    this.nextSequence.set(resultTabId, 0);
    this.emit(resultTabId);
  }

  /** Applies authoritative server values after a successful commit. */
  replaceRow(resultTabId: string, rowIndex: number, row: DbValue[]): void {
    this.update(resultTabId, (s) => {
      if (rowIndex >= 0 && rowIndex < s.rows.length) s.rows[rowIndex] = row;
      return { ...s };
    });
  }

  removeRows(resultTabId: string, rowIndexes: number[]): void {
    this.update(resultTabId, (s) => {
      for (const idx of [...rowIndexes].sort((a, b) => b - a)) s.rows.splice(idx, 1);
      return { ...s, rowCount: (s.rowCount ?? s.rows.length + rowIndexes.length) - rowIndexes.length };
    });
  }

  pushRows(resultTabId: string, rows: DbValue[][]): void {
    this.update(resultTabId, (s) => {
      s.rows.push(...rows);
      return { ...s, rowCount: (s.rowCount ?? s.rows.length - rows.length) + rows.length };
    });
  }

  setStarted(resultTabId: string, executionId: string): void {
    this.update(resultTabId, (s) => ({ ...s, executionId, status: "running" }));
  }

  setColumns(resultTabId: string, columns: ColumnMeta[]): void {
    this.update(resultTabId, (s) => ({ ...s, columns }));
  }

  appendRows(resultTabId: string, sequence: number, rows: DbValue[][]): boolean {
    const expected = this.nextSequence.get(resultTabId);
    if (expected === undefined || this.states.get(resultTabId)?.protocolError) return false; // disposed tab, late chunk
    if (sequence !== expected) {
      this.update(resultTabId, (s) => ({
        ...s,
        status: "failed",
        protocolError: true,
        error: {
          code: "INTERNAL_ERROR",
          message: `chunk sequence mismatch: expected ${expected}, got ${sequence}`,
          retryable: false,
          sqlState: null,
          position: null,
          detail: null,
          hint: null,
        },
      }));
      return false;
    }
    this.nextSequence.set(resultTabId, expected + 1);
    this.update(resultTabId, (s) => {
      s.rows.push(...rows);
      return { ...s, nextRowOffset: (s.nextRowOffset ?? 0) + rows.length };
    });
    return true;
  }

  setCommand(resultTabId: string, commandTag: string, affectedRows: number | null): void {
    this.update(resultTabId, (s) => ({ ...s, commandTag, affectedRows }));
  }

  setTerminal(
    resultTabId: string,
    terminal: Pick<
      ResultSnapshot,
      "status" | "error" | "rowCount" | "truncated" | "durationMs" | "transactionState"
    >,
  ): void {
    this.update(resultTabId, (s) => ({ ...s, ...terminal,
      hasMoreRows: Boolean(s.pageable && !s.protocolError && terminal.status !== "failed" && (terminal.rowCount ?? 0) > (s.nextRowOffset ?? 0)),
      ...(s.protocolError ? { status: "failed", error: s.error } : {}) }));
  }

  setPageLoading(resultTabId: string, loadingMore: boolean, pageError?: string): void {
    this.update(resultTabId, (s) => ({ ...s, loadingMore, pageError }));
  }

  appendPage(resultTabId: string, page: { rows: DbValue[][]; nextOffset: number; hasMore: boolean }): void {
    this.update(resultTabId, (s) => {
      s.rows.push(...page.rows);
      return { ...s, nextRowOffset: page.nextOffset, hasMoreRows: page.hasMore, loadingMore: false, pageError: undefined };
    });
  }

  getSnapshot(resultTabId: string): ResultSnapshot {
    return this.states.get(resultTabId) ?? EMPTY;
  }

  subscribe(resultTabId: string, listener: () => void): () => void {
    let set = this.listeners.get(resultTabId);
    if (!set) {
      set = new Set();
      this.listeners.set(resultTabId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(resultTabId);
    };
  }

  dispose(resultTabId: string): void {
    editStore.clear(resultTabId);
    this.states.delete(resultTabId);
    this.nextSequence.delete(resultTabId);
    this.emit(resultTabId);
  }

  private update(resultTabId: string, fn: (s: ResultSnapshot) => ResultSnapshot): void {
    const current = this.states.get(resultTabId);
    if (!current) return;
    this.states.set(resultTabId, fn(current));
    this.emit(resultTabId);
  }

  private emit(resultTabId: string): void {
    this.listeners.get(resultTabId)?.forEach((fn) => fn());
  }
}

export const resultStore = new ResultStore();
