// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

const STORAGE_KEY = "dbpod.app-settings.v1";

async function loadWith(shortcuts: Record<string, string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ shortcuts }));
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
