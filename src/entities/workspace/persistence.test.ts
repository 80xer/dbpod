import { beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock("../../shared/ipc/invoke", () => ({ ipc: { workspaceSnapshotLoad: mocks.load, workspaceSnapshotSave: mocks.save } }));
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); mocks.save.mockResolvedValue(undefined); });

test("failed restore blocks autosave and surfaces recovery error", async () => {
  mocks.load.mockRejectedValue(new Error("keychain locked"));
  const p = await import("./persistence");
  await p.preloadSnapshot();
  await expect(p.saveWorkspaceNow()).rejects.toThrow("keychain locked");
  expect(mocks.save).not.toHaveBeenCalled();
  expect(p.getPersistenceError()).toContain("keychain locked");
});

test("startup waits for one restore and keeps unopened profile drafts on save", async () => {
  let resolve!: (value: unknown) => void;
  mocks.load.mockReturnValue(new Promise((r) => { resolve = r; }));
  const p = await import("./persistence");
  const load = p.preloadSnapshot(); const save = p.saveWorkspaceNow();
  expect(mocks.save).not.toHaveBeenCalled();
  resolve({ version: 1, connections: [{ profileId: "offline", activeTabIndex: 0, tabs: [{ title: "draft", sql: "select 'secret'" }] }] });
  await load; await save;
  expect(mocks.load).toHaveBeenCalledTimes(1);
  expect(mocks.save.mock.calls[0][0].connections[0].tabs[0].sql).toBe("select 'secret'");
});

test("write failures remain visible and a successful retry clears them", async () => {
  mocks.load.mockResolvedValue(null); mocks.save.mockRejectedValueOnce(new Error("disk full"));
  const p = await import("./persistence");
  await expect(p.saveWorkspaceNow()).rejects.toThrow("disk full");
  expect(p.getPersistenceError()).toContain("disk full");
  await p.saveWorkspaceNow(); expect(p.getPersistenceError()).toBe("");
});

test("migrates legacy drafts to the initial database and saves each database independently", async () => {
  mocks.load.mockResolvedValue({ version: 1, connections: [
    { profileId: "same-profile", activeTabIndex: 0, tabs: [{ title: "legacy", sql: "SELECT 'default'" }] },
    { profileId: "same-profile", database: "archive", activeTabIndex: 0, tabs: [{ title: "closed", sql: "SELECT 'archive'" }] },
  ] });
  const p = await import("./persistence");
  const { openConnections } = await import("../connection/openConnections");
  const { emptyWorkspace, dispatchWorkspace, workspaceStates, sqlDrafts } = await import("./workspaceStore");
  const profile = { id: "same-profile", name: "Local", database: "postgres", host: "localhost", port: 5432, username: "user", environment: "local" as const, color: null, tlsMode: "verify-full" as const, readOnly: false, queryTimeoutMs: 60000, maxRows: 500, hasStoredCredential: false };
  await p.preloadSnapshot();
  const restored = p.restoreWorkspace(profile.id, "postgres")!;
  expect(sqlDrafts.get(restored.tabs[0].id)).toBe("SELECT 'default'");
  expect(p.restoreWorkspace(profile.id, "analytics")).toBeUndefined();
  openConnections.set("default", profile);
  workspaceStates.set("default", restored);
  openConnections.set("other", { ...profile, database: "analytics" });
  workspaceStates.set("other", emptyWorkspace());
  dispatchWorkspace("other", { type: "TAB_ADDED", tabId: "analytics-tab" });
  sqlDrafts.set("analytics-tab", "SELECT 'analytics'");
  dispatchWorkspace("other", { type: "TAB_ADDED", tabId: "definition-tab", title: "Function code", routineOid: 42 });
  sqlDrafts.set("definition-tab", "server definition must not be persisted as a draft");
  await p.saveWorkspaceNow();
  const saved = mocks.save.mock.calls[0][0].connections;
  expect(saved).toHaveLength(3);
  expect(saved.find((c: { database: string }) => c.database === "postgres").tabs[0].sql).toBe("SELECT 'default'");
  expect(saved.find((c: { database: string }) => c.database === "analytics").tabs[0].sql).toBe("SELECT 'analytics'");
  expect(saved.find((c: { database: string }) => c.database === "analytics").tabs).toHaveLength(1);
  expect(saved.find((c: { database: string }) => c.database === "archive").tabs[0].sql).toBe("SELECT 'archive'");
  expect(sqlDrafts.get(p.restoreWorkspace(profile.id, "analytics")!.tabs[0].id)).toBe("SELECT 'analytics'");
  expect(sqlDrafts.get(p.restoreWorkspace(profile.id, "postgres")!.tabs[0].id)).toBe("SELECT 'default'");
  openConnections.delete("default"); openConnections.delete("other"); workspaceStates.clear(); sqlDrafts.clear();
});

test("persists and restores split tab groups", async () => {
  mocks.load.mockResolvedValue({ version: 1, connections: [] });
  const p = await import("./persistence");
  const { openConnections } = await import("../connection/openConnections");
  const { dispatchWorkspace, emptyWorkspace, workspaceStates, sqlDrafts } = await import("./workspaceStore");
  const profile = { id: "split-profile", name: "Local", database: "postgres", host: "localhost", port: 5432, username: "user", environment: "local" as const, color: null, tlsMode: "verify-full" as const, readOnly: false, queryTimeoutMs: 60000, maxRows: 500, hasStoredCredential: false };
  await p.preloadSnapshot();
  openConnections.set("conn", profile);
  workspaceStates.set("conn", emptyWorkspace());

  dispatchWorkspace("conn", { type: "TAB_ADDED", tabId: "left" });
  dispatchWorkspace("conn", { type: "TAB_ADDED", tabId: "right", split: true });
  dispatchWorkspace("conn", { type: "TAB_ADDED", tabId: "right-2" });
  sqlDrafts.set("left", "SELECT 1");
  sqlDrafts.set("right", "SELECT 2");
  sqlDrafts.set("right-2", "SELECT 3");

  await p.saveWorkspaceNow();
  const groups = mocks.save.mock.calls[0][0].connections[0].tabGroups as Array<{ id: string; tabIds: string[]; activeTabId?: string }>;
  expect(groups).toHaveLength(2);
  expect(groups.map((group) => group.tabIds)).toEqual([["left"], ["right", "right-2"]]);

  openConnections.delete("conn");
  workspaceStates.clear();
  sqlDrafts.clear();
  p.restoreWorkspace("split-profile", "postgres");
  const restored = p.restoreWorkspace("split-profile", "postgres")!;
  expect(restored.tabGroups).toEqual(groups);
  expect(restored.tabs.map((tab) => tab.id)).toEqual(["left", "right", "right-2"]);
});
