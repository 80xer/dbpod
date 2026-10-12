// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

const STORAGE_KEY = "dbpod.app-settings.v1";

async function loadWith(shortcuts: Record<string, string>, shortcutsRevision?: number) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ shortcuts, shortcutsRevision }));
  vi.resetModules();
  const { getAppSettings } = await import("./appSettings");
  return getAppSettings().shortcuts;
}

afterEach(() => localStorage.clear());

it("frees Mod+Period from the alternate cancel in settings saved before completion had it", async () => {
  const shortcuts = await loadWith({ cancelQueryAlternate: "Mod+Period" });
  expect(shortcuts.cancelQueryAlternate).toBe("");
  expect(shortcuts.triggerCompletion).toBe("Mod+Period");
});

it("keeps an alternate cancel chosen alongside the completion shortcut", async () => {
  const shortcuts = await loadWith({ cancelQueryAlternate: "Mod+Period", triggerCompletion: "Ctrl+Space" });
  expect(shortcuts.cancelQueryAlternate).toBe("Mod+Period");
  expect(shortcuts.triggerCompletion).toBe("Ctrl+Space");
});

it("moves add-next-occurrence from its old default Mod+Shift+D to Mod+L once", async () => {
  expect((await loadWith({ addNextMatch: "Mod+Shift+KeyD" })).addNextMatch).toBe("Mod+KeyL");
  // Chosen after the move, the old key is the user's and stays.
  expect((await loadWith({ addNextMatch: "Mod+Shift+KeyD" }, 1)).addNextMatch).toBe("Mod+Shift+KeyD");
  // A Mod+L the user gave another shortcut is not taken from it.
  const kept = await loadWith({ addNextMatch: "Mod+Shift+KeyD", formatSql: "Mod+KeyL" });
  expect(kept).toMatchObject({ addNextMatch: "Mod+Shift+KeyD", formatSql: "Mod+KeyL" });
});

it("leaves the new-tab shortcut unbound when stored settings already gave Mod+T to another shortcut", async () => {
  expect((await loadWith({})).newQueryTab).toBe("Mod+KeyT");
  const kept = await loadWith({ formatSql: "Mod+KeyT" });
  expect(kept).toMatchObject({ formatSql: "Mod+KeyT", newQueryTab: "" });
});
