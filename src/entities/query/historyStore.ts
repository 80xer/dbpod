import { useSyncExternalStore } from "react";

export type HistoryEntry = {
  id: string;
  connectionId: string;
  sql: string;
  startedAt: string;
  durationMs?: number;
  status: "completed" | "failed" | "cancelled";
};

const MAX_ENTRIES = 500;

/**
 * Session-only query history: memory only, never written to disk.
 * ponytail: encrypted persistent history is a follow-up; keeping it in
 * memory satisfies the privacy baseline (nothing to wipe) for MVP.
 */
class HistoryStore {
  private entries: HistoryEntry[] = [];
  private listeners = new Set<() => void>();
  private enabled = true;

  record(entry: Omit<HistoryEntry, "id">): void {
    if (!this.enabled) return;
    this.entries = [{ ...entry, id: crypto.randomUUID() }, ...this.entries].slice(0, MAX_ENTRIES);
    this.emit();
  }

  remove(id: string): void {
    this.entries = this.entries.filter((e) => e.id !== id);
    this.emit();
  }

  clear(connectionId?: string): void {
    this.entries = connectionId
      ? this.entries.filter((e) => e.connectionId !== connectionId)
      : [];
    this.emit();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.clear();
    this.emit();
  }

  isEnabled = (): boolean => this.enabled;
  list = (): HistoryEntry[] => this.entries;
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }
}

export const historyStore = new HistoryStore();

export function useHistory(): HistoryEntry[] {
  return useSyncExternalStore(historyStore.subscribe, historyStore.list);
}
