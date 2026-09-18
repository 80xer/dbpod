import { useSyncExternalStore } from "react";
import type { AiMessageSnapshot, AiSessionSnapshot } from "../../generated/ipc-types";
import { saveWorkspaceSoon } from "../workspace/persistence";

const MAX_SESSIONS = 50;
// The whole snapshot shares a 5 MiB ceiling with SQL drafts and saved queries;
// a transcript full of markdown answers would reach it on its own.
const MAX_TOTAL_BYTES = 1_500_000;

/**
 * AI chat transcripts, persisted inside the encrypted workspace snapshot so a
 * restart keeps them: the conversations quote schema and queries, which do not
 * belong in localStorage. Newest first, oldest dropped once the budget is hit.
 */
class AiSessionStore {
  private entries: AiSessionSnapshot[] = [];
  private listeners = new Set<() => void>();

  hydrate(entries: AiSessionSnapshot[]): void {
    this.entries = [...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    this.emit();
  }

  get(id: string): AiSessionSnapshot | undefined {
    return this.entries.find((e) => e.id === id);
  }

  /** Called after every finished turn; a transcript that did not change is left alone. */
  upsert(session: Omit<AiSessionSnapshot, "title" | "updatedAt">): void {
    if (session.messages.length === 0) return;
    const previous = this.get(session.id);
    if (previous
      && previous.cliSessionId === session.cliSessionId
      && previous.messages.length === session.messages.length
      && previous.messages.every((m, i) => m.text === session.messages[i].text)) return;
    const entry: AiSessionSnapshot = {
      ...session,
      title: titleOf(session.messages),
      updatedAt: new Date().toISOString(),
    };
    this.commit([entry, ...this.entries.filter((e) => e.id !== session.id)]);
  }

  remove(id: string): void {
    this.commit(this.entries.filter((e) => e.id !== id));
  }

  private commit(next: AiSessionSnapshot[]): void {
    const kept = next.slice(0, MAX_SESSIONS);
    while (kept.length > 1 && new TextEncoder().encode(JSON.stringify(kept)).length > MAX_TOTAL_BYTES) {
      kept.pop();
    }
    this.entries = kept;
    this.emit();
    saveWorkspaceSoon();
  }

  list = (): AiSessionSnapshot[] => this.entries;
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }
}

function titleOf(messages: AiMessageSnapshot[]): string {
  const first = messages.find((m) => m.role === "user")?.text.trim().replace(/\s+/g, " ") ?? "새 대화";
  return first.length > 60 ? `${first.slice(0, 60)}…` : first;
}

export const aiSessionStore = new AiSessionStore();

export function useAiSessions(): AiSessionSnapshot[] {
  return useSyncExternalStore(aiSessionStore.subscribe, aiSessionStore.list);
}
