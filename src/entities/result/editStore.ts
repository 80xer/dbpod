export type CellDraft = { value: string | null }; // null = SQL NULL

export type InsertCell =
  | { mode: "value"; value: string }
  | { mode: "null" }
  | { mode: "default" };

export type InsertDraft = {
  draftId: string;
  cells: Record<string, InsertCell>; // by column name; missing column = default
};

export type EditSnapshot = {
  /** rowIndex -> columnName -> draft */
  updates: Map<number, Map<string, CellDraft>>;
  deletes: Set<number>;
  inserts: InsertDraft[];
  pendingCount: number;
};

const EMPTY: EditSnapshot = {
  updates: new Map(),
  deletes: new Set(),
  inserts: [],
  pendingCount: 0,
};

/** Per-result-tab edit buffer, outside the React tree (mirrors ResultStore). */
class EditStore {
  private states = new Map<string, EditSnapshot>();
  private listeners = new Map<string, Set<() => void>>();

  getSnapshot(tabId: string): EditSnapshot {
    return this.states.get(tabId) ?? EMPTY;
  }

  subscribe(tabId: string, fn: () => void): () => void {
    let set = this.listeners.get(tabId);
    if (!set) {
      set = new Set();
      this.listeners.set(tabId, set);
    }
    set.add(fn);
    return () => {
      set.delete(fn);
      if (set.size === 0) this.listeners.delete(tabId);
    };
  }

  setCell(tabId: string, rowIndex: number, column: string, draft: CellDraft | undefined): void {
    const s = this.mutable(tabId);
    const updates = new Map(s.updates);
    const row = new Map(updates.get(rowIndex) ?? []);
    if (draft === undefined) row.delete(column);
    else row.set(column, draft);
    if (row.size === 0) updates.delete(rowIndex);
    else updates.set(rowIndex, row);
    this.commit(tabId, { ...s, updates });
  }

  toggleDelete(tabId: string, rowIndex: number): void {
    const s = this.mutable(tabId);
    const deletes = new Set(s.deletes);
    if (deletes.has(rowIndex)) deletes.delete(rowIndex);
    else deletes.add(rowIndex);
    this.commit(tabId, { ...s, deletes });
  }

  addInsert(tabId: string, cells: Record<string, InsertCell> = {}): string {
    const s = this.mutable(tabId);
    const draftId = crypto.randomUUID();
    this.commit(tabId, { ...s, inserts: [...s.inserts, { draftId, cells }] });
    return draftId;
  }

  setInsertCell(tabId: string, draftId: string, column: string, cell: InsertCell): void {
    const s = this.mutable(tabId);
    this.commit(tabId, {
      ...s,
      inserts: s.inserts.map((d) =>
        d.draftId === draftId ? { ...d, cells: { ...d.cells, [column]: cell } } : d,
      ),
    });
  }

  removeInsert(tabId: string, draftId: string): void {
    const s = this.mutable(tabId);
    this.commit(tabId, { ...s, inserts: s.inserts.filter((d) => d.draftId !== draftId) });
  }

  clear(tabId: string): void {
    this.states.delete(tabId);
    this.emit(tabId);
  }

  private mutable(tabId: string): EditSnapshot {
    return this.states.get(tabId) ?? { ...EMPTY, updates: new Map(), deletes: new Set(), inserts: [] };
  }

  private commit(tabId: string, next: EditSnapshot): void {
    next.pendingCount =
      [...next.updates.values()].reduce((a, m) => a + m.size, 0) +
      next.deletes.size +
      next.inserts.length;
    this.states.set(tabId, next);
    this.emit(tabId);
  }

  private emit(tabId: string): void {
    this.listeners.get(tabId)?.forEach((fn) => fn());
  }
}

export const editStore = new EditStore();
