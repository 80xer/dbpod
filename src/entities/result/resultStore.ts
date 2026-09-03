import type {
  AppError,
  ColumnMeta,
  DbValue,
  TransactionState,
} from "../../generated/ipc-types";

export type ResultStatus = "idle" | "running" | "completed" | "failed" | "cancelled";

export type ResultSnapshot = {
  executionId?: string;
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

  create(resultTabId: string): void {
    this.states.set(resultTabId, { columns: [], rows: [], status: "running" });
    this.nextSequence.set(resultTabId, 0);
    this.emit(resultTabId);
  }

  setStarted(resultTabId: string, executionId: string): void {
    this.update(resultTabId, (s) => ({ ...s, executionId, status: "running" }));
  }

  setColumns(resultTabId: string, columns: ColumnMeta[]): void {
    this.update(resultTabId, (s) => ({ ...s, columns }));
  }

  appendRows(resultTabId: string, sequence: number, rows: DbValue[][]): void {
    const expected = this.nextSequence.get(resultTabId);
    if (expected === undefined) return; // disposed tab, late chunk
    if (sequence !== expected) {
      this.update(resultTabId, (s) => ({
        ...s,
        status: "failed",
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
      return;
    }
    this.nextSequence.set(resultTabId, expected + 1);
    this.update(resultTabId, (s) => {
      s.rows.push(...rows);
      return { ...s };
    });
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
    this.update(resultTabId, (s) => ({ ...s, ...terminal }));
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
