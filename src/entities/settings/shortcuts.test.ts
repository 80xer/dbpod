// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isValidShortcut, shortcutFromEvent, shortcutMatches, shortcutsConflict, shortcutToCodeMirror } from "./shortcuts";

describe("shortcuts", () => {
  it("normalizes editable shortcuts and recognizes panel/tab navigation", () => {
    const panel = new KeyboardEvent("keydown", { key: "ArrowRight", code: "ArrowRight", metaKey: true, shiftKey: true });
    const tab = new KeyboardEvent("keydown", { key: "ArrowLeft", code: "ArrowLeft", metaKey: true, altKey: true });
    expect(shortcutMatches(panel, "Mod+Shift+ArrowRight")).toBe(true);
    expect(shortcutMatches(tab, "Mod+Alt+ArrowLeft")).toBe(true);
    expect(shortcutFromEvent(new KeyboardEvent("keydown", { key: "1", code: "Digit1", metaKey: true }), true)).toBe("Mod+Digit");
    expect(shortcutsConflict("Mod+Digit", "Mod+Digit3")).toBe(true);
    expect(shortcutToCodeMirror("Mod+Shift+Enter")).toBe("Mod-Shift-Enter");
    expect(isValidShortcut("Mod+Alt+ArrowRight")).toBe(true);
    expect(isValidShortcut("broken shortcut")).toBe(false);
  });
});
