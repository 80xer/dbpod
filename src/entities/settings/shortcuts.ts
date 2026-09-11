export const shortcutDefinitions = [
  { id: "runQuery", label: "현재 SQL 실행", defaultValue: "Mod+Enter" },
  { id: "runQueryNew", label: "새 Result에서 실행", defaultValue: "Mod+Shift+Enter" },
  { id: "cancelQuery", label: "실행 취소", defaultValue: "Escape" },
  { id: "cancelQueryAlternate", label: "실행 취소 (보조)", defaultValue: "Mod+Period" },
  { id: "splitPanel", label: "패널 분할", defaultValue: "Mod+KeyD" },
  { id: "closeTab", label: "현재 탭 닫기", defaultValue: "Mod+KeyW" },
  { id: "previousPanel", label: "이전 패널", defaultValue: "Mod+Shift+ArrowLeft" },
  { id: "nextPanel", label: "다음 패널", defaultValue: "Mod+Shift+ArrowRight" },
  { id: "previousTab", label: "이전 탭", defaultValue: "Ctrl+Shift+Tab" },
  { id: "nextTab", label: "다음 탭", defaultValue: "Ctrl+Tab" },
  { id: "previousTabArrow", label: "이전 탭 (방향키)", defaultValue: "Mod+Alt+ArrowLeft" },
  { id: "nextTabArrow", label: "다음 탭 (방향키)", defaultValue: "Mod+Alt+ArrowRight" },
  { id: "tabByNumber", label: "번호로 탭 이동", defaultValue: "Mod+Digit" },
  { id: "selectGridRow", label: "그리드 행 전체 선택", defaultValue: "Shift+Space" },
  { id: "copyGrid", label: "그리드 선택 영역 복사", defaultValue: "Mod+KeyC" },
  { id: "toggleAi", label: "AI 패널 열기/닫기", defaultValue: "Mod+Shift+KeyI" },
  { id: "openSettings", label: "설정 열기", defaultValue: "Mod+Comma" },
] as const;

export type ShortcutId = typeof shortcutDefinitions[number]["id"];
export type ShortcutSettings = Record<ShortcutId, string>;

export const defaultShortcuts = Object.fromEntries(
  shortcutDefinitions.map(({ id, defaultValue }) => [id, defaultValue]),
) as ShortcutSettings;

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const shortcutKeys = /^(Key[A-Z]|Digit(?:[1-9])?|Enter|Escape|Tab|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|Space|Period|Comma)$/;

export function isValidShortcut(shortcut: unknown): shortcut is string {
  if (typeof shortcut !== "string") return false;
  const parts = shortcut.split("+");
  const key = parts.pop() ?? "";
  return shortcutKeys.test(key) && new Set(parts).size === parts.length
    && parts.every((part) => ["Mod", "Ctrl", "Alt", "Shift"].includes(part));
}

function eventKey(event: KeyboardEvent | ReactKeyboardEvent, digitPattern = false): string | null {
  if (["Meta", "Control", "Alt", "Shift"].includes(event.key)) return null;
  if (/^Digit[1-9]$/.test(event.code)) return digitPattern ? "Digit" : event.code;
  if (/^Key[A-Z]$/.test(event.code)) return event.code;
  if (/^[1-9]$/.test(event.key)) return digitPattern ? "Digit" : `Digit${event.key}`;
  if (/^[a-z]$/i.test(event.key)) return `Key${event.key.toUpperCase()}`;
  if (event.code === "Period") return "Period";
  if (event.code === "Comma") return "Comma";
  if (event.code === "Space") return "Space";
  return ["Enter", "Escape", "Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Space"].includes(event.key)
    ? event.key : null;
}

export function shortcutFromEvent(event: KeyboardEvent | ReactKeyboardEvent, digitPattern = false): string | null {
  const key = eventKey(event, digitPattern);
  if (!key) return null;
  const parts: string[] = [];
  if (event.metaKey || (!isMac && event.ctrlKey)) parts.push("Mod");
  if (event.ctrlKey && isMac) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (!parts.length && key.length === 1) return null;
  return [...parts, key].join("+");
}

function signature(shortcut: string): { modifiers: string; key: string } {
  const parts = shortcut.split("+");
  const key = parts.pop() ?? "";
  const modifiers = parts.map((part) => part === "Mod" ? (isMac ? "Meta" : "Ctrl") : part).sort().join("+");
  return { modifiers, key };
}

export function shortcutsConflict(left: string, right: string): boolean {
  const a = signature(left);
  const b = signature(right);
  return a.modifiers === b.modifiers && (a.key === b.key || (a.key === "Digit" && /^Digit[1-9]$/.test(b.key)) || (b.key === "Digit" && /^Digit[1-9]$/.test(a.key)));
}

export function shortcutMatches(event: KeyboardEvent | ReactKeyboardEvent, shortcut: string): boolean {
  const expected = signature(shortcut);
  const actual = shortcutFromEvent(event, expected.key === "Digit");
  return actual !== null && shortcutsConflict(actual, shortcut);
}

export function shortcutDigit(event: KeyboardEvent): number | null {
  return /^Digit[1-9]$/.test(event.code) ? Number(event.code.slice(5)) : /^[1-9]$/.test(event.key) ? Number(event.key) : null;
}

export function displayShortcut(shortcut: string): string {
  const labels: Record<string, string> = {
    Mod: isMac ? "Cmd" : "Ctrl", Ctrl: "Ctrl", Alt: isMac ? "Option" : "Alt", Shift: "Shift",
    ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Period: ".", Comma: ",", Space: "Space", Digit: "1…9",
  };
  return shortcut.split("+").map((part) => labels[part] ?? part.replace(/^Key/, "").replace(/^Digit/, "")).join("+");
}

export function shortcutToCodeMirror(shortcut: string): string {
  const parts = shortcut.split("+");
  const key = parts.pop() ?? "";
  const codeMirrorKey = key === "Period" ? "." : key === "Comma" ? "," : /^Key[A-Z]$/.test(key)
    ? key.slice(3).toLowerCase() : /^Digit[1-9]$/.test(key) ? key.slice(5) : key;
  return [...parts, codeMirrorKey].join("-");
}
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
