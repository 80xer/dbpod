import type { WorkspaceSnapshot } from "../../generated/ipc-types";
import { ipc } from "../../shared/ipc/invoke";
import { openConnections } from "../connection/openConnections";
import {
  sqlDrafts,
  workspaceStates,
  type WorkspaceState,
} from "./workspaceStore";

let cache: WorkspaceSnapshot | null = null;
let loaded = false;

/** Called once at app start (connections page mount). */
export async function preloadSnapshot(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    cache = await ipc.workspaceSnapshotLoad();
  } catch {
    cache = null;
  }
}

/** Rebuilds a workspace from the last snapshot for this profile, if any. */
export function restoreWorkspace(profileId: string): WorkspaceState | undefined {
  const conn = cache?.connections.find((c) => c.profileId === profileId);
  if (!conn || conn.tabs.length === 0) return undefined;
  const tabs = conn.tabs.map((t) => {
    const id = crypto.randomUUID();
    sqlDrafts.set(id, t.sql);
    return {
      id,
      title: t.title,
      kind: "query" as const,
      resultTabs: [],
    };
  });
  const activeIdx = Math.min(conn.activeTabIndex ?? 0, tabs.length - 1);
  return {
    tabs,
    activeTabId: tabs[activeIdx]?.id,
    nextTabNumber: tabs.length + 1,
    nextResultNumber: 1,
  };
}

function buildSnapshot(): WorkspaceSnapshot {
  const byProfile = new Map<string, WorkspaceSnapshot["connections"][number]>();
  // Start from the previous snapshot so profiles not opened this run keep theirs.
  for (const c of cache?.connections ?? []) byProfile.set(c.profileId, c);
  for (const [connectionId, profile] of openConnections.entries()) {
    const state = workspaceStates.get(connectionId);
    if (!state) continue;
    const queryTabs = state.tabs.filter((t) => t.kind === "query");
    byProfile.set(profile.id, {
      profileId: profile.id,
      activeTabIndex: Math.max(
        0,
        queryTabs.findIndex((t) => t.id === state.activeTabId),
      ),
      tabs: queryTabs.map((t) => ({
        title: t.title,
        sql: sqlDrafts.get(t.id) ?? "",
      })),
    });
  }
  return { version: 1, connections: [...byProfile.values()] };
}

let timer: ReturnType<typeof setTimeout> | undefined;

/** Debounced snapshot write (SQL drafts + tab layout only). */
export function saveWorkspaceSoon(): void {
  clearTimeout(timer);
  timer = setTimeout(() => void saveWorkspaceNow(), 1500);
}

export async function saveWorkspaceNow(): Promise<void> {
  clearTimeout(timer);
  const snapshot = buildSnapshot();
  cache = snapshot;
  try {
    await ipc.workspaceSnapshotSave(snapshot);
  } catch {
    // Persistence failures never break the session; retried on next change.
  }
}
