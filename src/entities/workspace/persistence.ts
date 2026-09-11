import type { WorkspaceSnapshot } from "../../generated/ipc-types";
import { ipc } from "../../shared/ipc/invoke";
import { openConnections } from "../connection/openConnections";
import {
  getTabGroups,
  type QueryTabGroup,
  sqlDrafts,
  workspaceStates,
  type WorkspaceState,
} from "./workspaceStore";

let cache: WorkspaceSnapshot | null = null;
let loadPromise: Promise<void> | undefined;
let loadFailed = false;
let persistenceError = "";
const listeners = new Set<() => void>();
export const getPersistenceError = () => persistenceError;
export function subscribePersistence(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function reportError(error: unknown): void {
  persistenceError = error ? `SQL 초안 저장 오류: ${(error as { message?: string }).message ?? String(error)}` : "";
  listeners.forEach((listener) => listener());
}

/** All connection opens await the same restore, so autosave cannot race startup. */
export function preloadSnapshot(): Promise<void> {
  loadPromise ??= ipc.workspaceSnapshotLoad().then((snapshot) => {
    cache = snapshot;
    loadFailed = false;
  }).catch((error: unknown) => {
    loadFailed = true;
    reportError(error);
  });
  return loadPromise;
}

/** Drafts belong to a profile/database pair, never to the whole server. */
export function restoreWorkspace(profileId: string, database: string): WorkspaceState | undefined {
  const conn = cache?.connections.find((c) => c.profileId === profileId && c.database === database)
    ?? cache?.connections.find((c) => c.profileId === profileId && c.database == null);
  // Legacy snapshots are claimed on the initial connection to the profile's default DB.
  if (conn) conn.database = database;
  if (!conn || conn.tabs.length === 0) return undefined;
  const restoredIds = conn.tabs.map((t) => t.id ?? crypto.randomUUID());
  const tabs = conn.tabs.map((t, index) => {
    const id = restoredIds[index];
    sqlDrafts.set(id, t.sql);
    return {
      id,
      title: t.title,
      kind: "query" as const,
      resultTabs: [],
    };
  });
  const idByOldId = new Map<string, string>(conn.tabs
    .map((tab, index) => [tab.id, restoredIds[index]])
    .filter((entry): entry is [string, string] => Boolean(entry[0])));
  const groupToQueryTabIds = (group: { id: string; tabIds: string[]; activeTabId: string | null }) =>
    ({
      ...group,
      tabIds: group.tabIds
        .map((id) => idByOldId.get(id))
        .filter((id): id is string => Boolean(id)),
      activeTabId: group.activeTabId ? idByOldId.get(group.activeTabId) : undefined,
    });
  const filteredGroups = (conn.tabGroups ?? [])
    .map(groupToQueryTabIds)
    .filter((group) => group.tabIds.length > 0)
    .map((group) => {
      const activeTabId = group.activeTabId;
      return activeTabId != null
        ? ({ id: group.id, tabIds: group.tabIds, activeTabId } as QueryTabGroup)
        : ({ id: group.id, tabIds: group.tabIds } as QueryTabGroup);
    });
  const tabGroups = filteredGroups.length ? filteredGroups : [{ id: "main", tabIds: tabs.map((t) => t.id), activeTabId: tabs[0]?.id }];
  const activeIdx = Math.min(conn.activeTabIndex ?? 0, tabs.length - 1);
  return {
    tabs,
    activeTabId: tabs[activeIdx]?.id,
    tabGroups: conn.tabGroups ? tabGroups : undefined,
    nextTabNumber: tabs.length + 1,
    nextResultNumber: 1,
  };
}

function buildSnapshot(): WorkspaceSnapshot {
  const byProfile = new Map<string, WorkspaceSnapshot["connections"][number]>();
  const key = (profileId: string, database?: string | null) => JSON.stringify([profileId, database ?? null]);
  // Start from the previous snapshot so profiles not opened this run keep theirs.
  for (const c of cache?.connections ?? []) byProfile.set(key(c.profileId, c.database), c);
  for (const [connectionId, profile] of openConnections.entries()) {
    const state = workspaceStates.get(connectionId);
    if (!state) continue;
    const queryTabs = state.tabs.filter((t) => t.kind === "query");
    byProfile.set(key(profile.id, profile.database), {
      profileId: profile.id,
      database: profile.database,
      tabGroups: queryTabs.length ? getTabGroups(state)
      .filter((group) => group.tabIds.some((id) => queryTabs.some((tab) => tab.id === id)))
      .map((group) => ({
        ...group,
        tabIds: group.tabIds.filter((id) => queryTabs.some((tab) => tab.id === id)),
        activeTabId: (group.activeTabId && group.tabIds.includes(group.activeTabId))
          ? group.activeTabId
          : group.tabIds[0] ?? null,
      }))
        .filter((group) => group.tabIds.length > 0) : null,
      activeTabIndex: Math.max(
        0,
        queryTabs.findIndex((t) => t.id === state.activeTabId),
      ),
      tabs: queryTabs.map((t) => ({
        title: t.title,
        sql: sqlDrafts.get(t.id) ?? "",
        id: t.id,
      })),
    });
  }
  return { version: 1, connections: [...byProfile.values()] };
}

let timer: ReturnType<typeof setTimeout> | undefined;

/** Debounced snapshot write (SQL drafts + tab layout only). */
export function saveWorkspaceSoon(): void {
  clearTimeout(timer);
  timer = setTimeout(() => { void saveWorkspaceNow().catch(() => undefined); }, 1500);
}

let saveChain: Promise<void> = Promise.resolve();
export async function saveWorkspaceNow(): Promise<void> {
  clearTimeout(timer);
  await preloadSnapshot();
  if (loadFailed) throw new Error(persistenceError);
  const snapshot = buildSnapshot();
  const save = saveChain.catch(() => undefined).then(async () => {
    try {
      await ipc.workspaceSnapshotSave(snapshot);
      cache = snapshot;
      reportError(null);
    } catch (error) {
      reportError(error);
      throw error;
    }
  });
  saveChain = save;
  return save;
}
