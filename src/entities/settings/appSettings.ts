import { useSyncExternalStore } from "react";
import { defaultShortcuts, isValidShortcut, shortcutDefinitions, type ShortcutSettings } from "./shortcuts";

export type AppTheme = "system" | "light" | "dark";
export type AppFont = "system" | "sans" | "mono";
export type AiProvider = "claude" | "codex";

export type AppSettings = {
  theme: AppTheme;
  font: AppFont;
  fontSize: number;
  shortcuts: ShortcutSettings;
  aiProvider: AiProvider;
  aiModel: string;
};

// Claude Code accepts these aliases and maps them to its current subscription models.
// Codex names mirror the models exposed by the installed ChatGPT CLI; `default` uses ~/.codex/config.toml.
export const aiModels: Record<AiProvider, string[]> = { claude: ["sonnet", "opus", "haiku"], codex: ["default", "gpt-5.3-codex-spark", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5"] };
export const defaultAppSettings: AppSettings = { theme: "system", font: "system", fontSize: 16, shortcuts: defaultShortcuts, aiProvider: "claude", aiModel: aiModels.claude[0] };
export const appFontSizes = [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24] as const;
export const appFonts: Array<{ value: AppFont; label: string; family: string }> = [
  { value: "system", label: "시스템 기본", family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
  { value: "sans", label: "고딕", family: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif" },
  { value: "mono", label: "고정폭", family: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace" },
];

const STORAGE_KEY = "dbpod.app-settings.v1";
const listeners = new Set<() => void>();
const media = typeof window === "undefined" || !window.matchMedia ? null : window.matchMedia("(prefers-color-scheme: dark)");

function load(): AppSettings {
  if (typeof localStorage === "undefined") return defaultAppSettings;
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<AppSettings> | null;
    return {
      theme: value && ["system", "light", "dark"].includes(value.theme ?? "") ? value.theme as AppTheme : defaultAppSettings.theme,
      font: value && appFonts.some((option) => option.value === value.font) ? value.font as AppFont : defaultAppSettings.font,
      fontSize: value && appFontSizes.includes(value.fontSize as typeof appFontSizes[number]) ? value.fontSize! : defaultAppSettings.fontSize,
      shortcuts: Object.fromEntries(shortcutDefinitions.map(({ id, defaultValue }) => [
        id,
        isValidShortcut(value?.shortcuts?.[id]) ? value.shortcuts[id] : defaultValue,
      ])) as ShortcutSettings,
      aiProvider: value?.aiProvider === "codex" ? "codex" : "claude",
      aiModel: aiModels[value?.aiProvider === "codex" ? "codex" : "claude"].includes(value?.aiModel ?? "") ? value!.aiModel! : aiModels[value?.aiProvider === "codex" ? "codex" : "claude"][0],
    };
  } catch {
    return defaultAppSettings;
  }
}

let settings = load();

function apply(): void {
  if (typeof document === "undefined") return;
  const resolvedTheme = settings.theme === "system" ? (media?.matches ? "dark" : "light") : settings.theme;
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.style.colorScheme = resolvedTheme;
  document.documentElement.style.setProperty("--app-font-family", appFonts.find((option) => option.value === settings.font)!.family);
  document.documentElement.style.setProperty("--app-font-size", `${settings.fontSize}px`);
}

export function setAppSettings(next: Partial<AppSettings>): void {
  settings = { ...settings, ...next };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  apply();
  listeners.forEach((listener) => listener());
}

export function resetAppSettings(): void {
  settings = { ...defaultAppSettings, shortcuts: { ...defaultShortcuts } };
  localStorage.removeItem(STORAGE_KEY);
  apply();
  listeners.forEach((listener) => listener());
}

export function getAppSettings(): AppSettings {
  return settings;
}

export function useAppSettings(): AppSettings {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    () => settings,
    () => defaultAppSettings,
  );
}

media?.addEventListener("change", () => { if (settings.theme === "system") apply(); });
apply();
