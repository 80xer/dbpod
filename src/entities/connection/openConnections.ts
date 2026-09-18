import { useSyncExternalStore } from "react";
import type { ConnectionProfile } from "../../generated/ipc-types";

/**
 * connectionId -> profile for connections opened in this app run.
 * In-memory only; a reload loses it and the workspace route redirects home.
 */
class OpenConnections {
  private map = new Map<string, ConnectionProfile>();
  private listeners = new Set<() => void>();
  private snapshot: Array<[string, ConnectionProfile]> = [];
  private order: string[] = [];

  get(id: string): ConnectionProfile | undefined {
    return this.map.get(id);
  }

  set(id: string, profile: ConnectionProfile): void {
    this.map.set(id, profile);
    this.changed();
  }

  delete(id: string): void {
    this.map.delete(id);
    this.changed();
  }

  entries = (): Array<[string, ConnectionProfile]> => this.snapshot;

  /**
   * Profile ids in the order the home list shows them, so the rail reads top to
   * bottom the same way. Ignoring an unchanged order keeps the snapshot
   * identity stable for useSyncExternalStore.
   */
  setOrder(profileIds: string[]): void {
    if (profileIds.length === this.order.length && profileIds.every((id, index) => this.order[index] === id)) return;
    this.order = profileIds;
    this.changed();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private changed(): void {
    // A profile the home list has not named yet sorts last and keeps its open order.
    const rank = new Map(this.order.map((id, index) => [id, index]));
    this.snapshot = [...this.map.entries()]
      .sort((a, b) => (rank.get(a[1].id) ?? rank.size) - (rank.get(b[1].id) ?? rank.size));
    this.listeners.forEach((fn) => fn());
  }
}

export const openConnections = new OpenConnections();

export function useOpenConnections(): Array<[string, ConnectionProfile]> {
  return useSyncExternalStore(openConnections.subscribe, openConnections.entries);
}
