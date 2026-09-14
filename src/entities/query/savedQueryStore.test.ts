import { beforeEach, describe, expect, it, vi } from "vitest";

const saveWorkspaceNow = vi.fn(async () => undefined);
vi.mock("../workspace/persistence", () => ({ saveWorkspaceNow: () => saveWorkspaceNow() }));

const { savedQueryStore } = await import("./savedQueryStore");

describe("savedQueryStore", () => {
  beforeEach(() => {
    savedQueryStore.hydrate([]);
    saveWorkspaceNow.mockReset().mockResolvedValue(undefined);
  });

  it("saves by name across connections and overwrites the same name", async () => {
    await savedQueryStore.save("daily", "SELECT 1");
    await savedQueryStore.save(" Daily ", "SELECT 2");
    expect(savedQueryStore.list()).toHaveLength(1);
    expect(savedQueryStore.find("DAILY")?.sql).toBe("SELECT 2");
    expect(saveWorkspaceNow).toHaveBeenCalledTimes(2);
  });

  it("keeps the list sorted and rejects a rename onto an existing name", async () => {
    await savedQueryStore.save("b", "SELECT 1");
    await savedQueryStore.save("a", "SELECT 2");
    expect(savedQueryStore.list().map((e) => e.name)).toEqual(["a", "b"]);
    const b = savedQueryStore.find("b")!;
    await expect(savedQueryStore.rename(b.id, "a")).rejects.toThrow();
    await expect(savedQueryStore.save("", "SELECT 1")).rejects.toThrow();
  });

  it("rolls back when the snapshot write fails", async () => {
    await savedQueryStore.save("keep", "SELECT 1");
    saveWorkspaceNow.mockRejectedValueOnce(new Error("keychain locked"));
    await expect(savedQueryStore.save("other", "SELECT 2")).rejects.toThrow("keychain locked");
    expect(savedQueryStore.list().map((e) => e.name)).toEqual(["keep"]);
  });
});
