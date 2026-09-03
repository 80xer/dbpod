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

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private changed(): void {
    this.snapshot = [...this.map.entries()];
    this.listeners.forEach((fn) => fn());
  }
}

export const openConnections = new OpenConnections();

export function useOpenConnections(): Array<[string, ConnectionProfile]> {
  return useSyncExternalStore(openConnections.subscribe, openConnections.entries);
}
