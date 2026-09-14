import { useSyncExternalStore } from "react";
import type { SavedQuery } from "../../generated/ipc-types";
import { saveWorkspaceNow } from "../workspace/persistence";

const MAX_ENTRIES = 500;
const MAX_SQL_BYTES = 200_000;

/**
 * Named SQL snippets, shared across every profile and database by design:
 * a saved query is looked up by name, never filtered by the current connection.
 * Persisted inside the encrypted workspace snapshot, so no extra store on disk.
 */
class SavedQueryStore {
  private entries: SavedQuery[] = [];
  private listeners = new Set<() => void>();

  /** Seeded from the snapshot before the first connection restores its tabs. */
  hydrate(entries: SavedQuery[]): void {
    this.entries = [...entries].sort((a, b) => a.name.localeCompare(b.name));
    this.emit();
  }

  find(name: string): SavedQuery | undefined {
    const key = name.trim().toLowerCase();
    return this.entries.find((e) => e.name.toLowerCase() === key);
  }

  /** Overwrites the entry with the same name so re-saving a draft stays one item. */
  async save(name: string, sql: string): Promise<SavedQuery> {
    const title = name.trim();
    if (!title) throw new Error("이름을 입력하세요");
    if (new TextEncoder().encode(sql).length > MAX_SQL_BYTES)
      throw new Error("쿼리가 너무 큽니다 (200KB 초과)");
    const entry: SavedQuery = {
      id: this.find(title)?.id ?? crypto.randomUUID(),
      name: title,
      sql,
      updatedAt: new Date().toISOString(),
    };
    const rest = this.entries.filter((e) => e.id !== entry.id);
    if (rest.length >= MAX_ENTRIES) throw new Error(`저장된 쿼리는 최대 ${MAX_ENTRIES}개입니다`);
    return this.commit([...rest, entry]).then(() => entry);
  }

  remove(id: string): Promise<void> {
    return this.commit(this.entries.filter((e) => e.id !== id));
  }

  async rename(id: string, name: string): Promise<void> {
    const title = name.trim();
    if (!title) throw new Error("이름을 입력하세요");
    const clash = this.find(title);
    if (clash && clash.id !== id) throw new Error("같은 이름의 쿼리가 이미 있습니다");
    return this.commit(this.entries.map((e) => (e.id === id ? { ...e, name: title } : e)));
  }

  /** Snapshot writes can fail (locked keychain); roll back so the list matches disk. */
  private async commit(next: SavedQuery[]): Promise<void> {
    const previous = this.entries;
    this.entries = [...next].sort((a, b) => a.name.localeCompare(b.name));
    this.emit();
    try {
      await saveWorkspaceNow();
    } catch (error) {
      this.entries = previous;
      this.emit();
      throw error;
    }
  }

  list = (): SavedQuery[] => this.entries;
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }
}

export const savedQueryStore = new SavedQueryStore();

export function useSavedQueries(): SavedQuery[] {
  return useSyncExternalStore(savedQueryStore.subscribe, savedQueryStore.list);
}
