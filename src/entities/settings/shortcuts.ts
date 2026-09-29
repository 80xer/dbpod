export const shortcutDefinitions = [
  { id: "runQuery", label: "현재 SQL 실행", defaultValue: "Mod+Enter", group: "실행" },
  { id: "runQueryNew", label: "새 Result에서 실행", defaultValue: "Mod+Shift+Enter", group: "실행" },
  { id: "cancelQuery", label: "실행 취소", defaultValue: "Escape", group: "실행" },
  { id: "cancelQueryAlternate", label: "실행 취소 (보조)", defaultValue: "Mod+Period", group: "실행" },
  { id: "saveQuery", label: "현재 쿼리 저장", defaultValue: "Mod+KeyS", group: "편집기" },
  { id: "formatSql", label: "현재 SQL 포맷", defaultValue: "Mod+Shift+KeyF", group: "편집기" },
  { id: "findInEditor", label: "찾기", defaultValue: "Mod+KeyF", group: "편집기" },
  { id: "findNext", label: "다음 찾기", defaultValue: "Mod+KeyG", group: "편집기" },
  { id: "findPrevious", label: "이전 찾기", defaultValue: "Mod+Shift+KeyG", group: "편집기" },
  { id: "gotoLine", label: "줄 번호로 이동", defaultValue: "Mod+Alt+KeyG", group: "편집기" },
  { id: "selectMatches", label: "선택과 같은 내용 모두 선택", defaultValue: "Mod+Shift+KeyL", group: "편집기" },
  { id: "addNextMatch", label: "다음 일치 항목에 커서 추가", defaultValue: "Mod+Shift+KeyD", group: "편집기" },
  { id: "splitPanel", label: "패널 분할", defaultValue: "Mod+KeyD", group: "탭 · 패널" },
  { id: "closeTab", label: "현재 탭 닫기", defaultValue: "Mod+KeyW", group: "탭 · 패널" },
  { id: "previousPanel", label: "이전 패널", defaultValue: "Mod+Shift+ArrowLeft", group: "탭 · 패널" },
  { id: "nextPanel", label: "다음 패널", defaultValue: "Mod+Shift+ArrowRight", group: "탭 · 패널" },
  { id: "previousTab", label: "이전 탭", defaultValue: "Ctrl+Shift+Tab", group: "탭 · 패널" },
  { id: "nextTab", label: "다음 탭", defaultValue: "Ctrl+Tab", group: "탭 · 패널" },
  { id: "previousTabArrow", label: "이전 탭 (방향키)", defaultValue: "Mod+Alt+ArrowLeft", group: "탭 · 패널" },
  { id: "nextTabArrow", label: "다음 탭 (방향키)", defaultValue: "Mod+Alt+ArrowRight", group: "탭 · 패널" },
  { id: "tabByNumber", label: "번호로 탭 이동", defaultValue: "Mod+Digit", group: "탭 · 패널" },
  { id: "editCell", label: "셀 편집 시작", defaultValue: "F2", group: "결과 그리드" },
  { id: "selectGridRow", label: "그리드 행 전체 선택", defaultValue: "Shift+Space", group: "결과 그리드" },
  { id: "selectAllGrid", label: "그리드 전체 선택", defaultValue: "Mod+KeyA", group: "결과 그리드" },
  { id: "copyGrid", label: "그리드 선택 영역 복사", defaultValue: "Mod+KeyC", group: "결과 그리드" },
  { id: "refreshResult", label: "결과 새로고침", defaultValue: "Mod+KeyR", group: "결과 그리드" },
  { id: "previousResult", label: "이전 Result 탭", defaultValue: "Mod+Alt+Shift+ArrowLeft", group: "결과 그리드" },
  { id: "nextResult", label: "다음 Result 탭", defaultValue: "Mod+Alt+Shift+ArrowRight", group: "결과 그리드" },
  { id: "toggleAi", label: "AI 패널 열기/닫기", defaultValue: "Mod+Shift+KeyI", group: "AI" },
  // The AI input never sees the editor's keys, so it keeps its own key space:
  // Mod+Enter sends here and runs the query there without either shadowing the other.
  { id: "aiSend", label: "AI 메시지 전송", defaultValue: "Mod+Enter", scope: "ai", group: "AI" },
  { id: "previousConnection", label: "이전 연결", defaultValue: "Mod+Shift+ArrowUp", group: "앱" },
  { id: "nextConnection", label: "다음 연결", defaultValue: "Mod+Shift+ArrowDown", group: "앱" },
  { id: "openSettings", label: "설정 열기", defaultValue: "Mod+Comma", group: "앱" },
] as const;

export type ShortcutId = typeof shortcutDefinitions[number]["id"];
export type ShortcutScope = "app" | "ai";
export const shortcutGroups = [...new Set(shortcutDefinitions.map((entry) => entry.group))];
export const shortcutScope = (id: ShortcutId): ShortcutScope => {
  const definition = shortcutDefinitions.find((entry) => entry.id === id);
  return definition && "scope" in definition ? definition.scope : "app";
};
export type ShortcutSettings = Record<ShortcutId, string>;

export const defaultShortcuts = Object.fromEntries(
  shortcutDefinitions.map(({ id, defaultValue }) => [id, defaultValue]),
) as ShortcutSettings;

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const shortcutKeys = /^(Key[A-Z]|Digit(?:[1-9])?|F(?:[1-9]|1[0-2])|Enter|Escape|Tab|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|Space|Period|Comma)$/;

/** The empty string is the unbound shortcut, and a stored one must survive a reload. */
export const UNBOUND = "";

export function isValidShortcut(shortcut: unknown): shortcut is string {
  if (typeof shortcut !== "string") return false;
  if (shortcut === UNBOUND) return true;
  const parts = shortcut.split("+");
  const key = parts.pop() ?? "";
  return shortcutKeys.test(key) && new Set(parts).size === parts.length
    && parts.every((part) => ["Mod", "Ctrl", "Alt", "Shift"].includes(part));
}

function eventKey(event: KeyboardEvent | ReactKeyboardEvent, digitPattern = false): string | null {
  if (["Meta", "Control", "Alt", "Shift"].includes(event.key)) return null;
  if (/^Digit[1-9]$/.test(event.code)) return digitPattern ? "Digit" : event.code;
  if (/^Key[A-Z]$/.test(event.code)) return event.code;
  if (/^F([1-9]|1[0-2])$/.test(event.key)) return event.key;
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
  // Nothing collides with a shortcut that is not bound, and two unbound ones are not
  // each other's conflict either.
  if (left === UNBOUND || right === UNBOUND) return false;
  const a = signature(left);
  const b = signature(right);
  return a.modifiers === b.modifiers && (a.key === b.key || (a.key === "Digit" && /^Digit[1-9]$/.test(b.key)) || (b.key === "Digit" && /^Digit[1-9]$/.test(a.key)));
}

export function shortcutMatches(event: KeyboardEvent | ReactKeyboardEvent, shortcut: string): boolean {
  if (shortcut === UNBOUND) return false;
  const expected = signature(shortcut);
  const actual = shortcutFromEvent(event, expected.key === "Digit");
  return actual !== null && shortcutsConflict(actual, shortcut);
}

export function shortcutDigit(event: KeyboardEvent): number | null {
  return /^Digit[1-9]$/.test(event.code) ? Number(event.code.slice(5)) : /^[1-9]$/.test(event.key) ? Number(event.key) : null;
}

export function displayShortcut(shortcut: string): string {
  if (shortcut === UNBOUND) return "없음";
  const labels: Record<string, string> = {
    Mod: isMac ? "Cmd" : "Ctrl", Ctrl: "Ctrl", Alt: isMac ? "Option" : "Alt", Shift: "Shift",
    ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Period: ".", Comma: ",", Space: "Space", Digit: "1…9",
  };
  return shortcut.split("+").map((part) => labels[part] ?? part.replace(/^Key/, "").replace(/^Digit/, "")).join("+");
}

/** Empty for an unbound shortcut; callers leave those out of the keymap. */
export function shortcutToCodeMirror(shortcut: string): string {
  if (shortcut === UNBOUND) return UNBOUND;
  const parts = shortcut.split("+");
  const key = parts.pop() ?? "";
  const codeMirrorKey = key === "Period" ? "." : key === "Comma" ? "," : /^Key[A-Z]$/.test(key)
    ? key.slice(3).toLowerCase() : /^Digit[1-9]$/.test(key) ? key.slice(5) : key;
  return [...parts, codeMirrorKey].join("-");
}
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
