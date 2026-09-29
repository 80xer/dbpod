// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { defaultShortcuts, displayShortcut, isValidShortcut, shortcutFromEvent, shortcutMatches, shortcutScope, shortcutsConflict, shortcutToCodeMirror, UNBOUND } from "./shortcuts";

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

  it("treats a cleared shortcut as bound to nothing", () => {
    const key = new KeyboardEvent("keydown", { key: "r", code: "KeyR", metaKey: true });
    expect(shortcutMatches(key, UNBOUND)).toBe(false);
    // Escape and the other unmodified keys reach the handler too, and an empty
    // binding must not swallow one of them either.
    expect(shortcutMatches(new KeyboardEvent("keydown", { key: "Escape" }), UNBOUND)).toBe(false);
    // Valid, or a reload would restore the default the user just removed.
    expect(isValidShortcut(UNBOUND)).toBe(true);
    expect(shortcutsConflict(UNBOUND, "Mod+KeyR")).toBe(false);
    expect(shortcutsConflict(UNBOUND, UNBOUND)).toBe(false);
    expect(shortcutToCodeMirror(UNBOUND)).toBe("");
    expect(displayShortcut(UNBOUND)).toBe("없음");
  });

  it("records unmodified function keys", () => {
    const f2 = new KeyboardEvent("keydown", { key: "F2", code: "F2" });
    expect(shortcutFromEvent(f2)).toBe("F2");
    expect(isValidShortcut("F2")).toBe(true);
    expect(isValidShortcut("F13")).toBe(false);
    expect(shortcutMatches(f2, defaultShortcuts.editCell)).toBe(true);
  });

  it("keeps the AI input's key space separate from the editor's", () => {
    // Both default to Mod+Enter on purpose: neither pane sees the other's keys.
    expect(defaultShortcuts.aiSend).toBe(defaultShortcuts.runQuery);
    expect(shortcutScope("aiSend")).toBe("ai");
    expect(shortcutScope("runQuery")).toBe("app");
  });

  it("keeps the search defaults on the keys CodeMirror already binds", () => {
    // SqlEditor only neutralizes a built-in key once these drift apart, so a
    // default that no longer matches would silently bind search twice.
    expect(shortcutToCodeMirror(defaultShortcuts.findInEditor)).toBe("Mod-f");
    expect(shortcutToCodeMirror(defaultShortcuts.findNext)).toBe("Mod-g");
    expect(shortcutToCodeMirror(defaultShortcuts.findPrevious)).toBe("Mod-Shift-g");
    expect(shortcutToCodeMirror(defaultShortcuts.gotoLine)).toBe("Mod-Alt-g");
    expect(shortcutToCodeMirror(defaultShortcuts.selectMatches)).toBe("Mod-Shift-l");
  });
});
