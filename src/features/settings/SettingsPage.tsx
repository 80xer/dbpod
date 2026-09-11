import { useEffect, useState } from "react";
import { aiModels, appFonts, appFontSizes, resetAppSettings, setAppSettings, useAppSettings, type AiProvider, type AppTheme } from "../../entities/settings/appSettings";
import { displayShortcut, shortcutDefinitions, shortcutFromEvent, shortcutsConflict, type ShortcutId } from "../../entities/settings/shortcuts";
import { Link } from "@tanstack/react-router";

const selectClass = "mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm";

export function SettingsPage() {
  const settings = useAppSettings();
  const [recording, setRecording] = useState<ShortcutId | null>(null);
  const [shortcutError, setShortcutError] = useState("");
  useEffect(() => {
    if (!recording) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const shortcut = shortcutFromEvent(event, recording === "tabByNumber");
      if (!shortcut) return;
      const conflict = shortcutDefinitions.find(({ id }) => id !== recording && shortcutsConflict(settings.shortcuts[id], shortcut));
      if (conflict) {
        setShortcutError(`이미 '${conflict.label}'에서 사용 중인 단축키입니다.`);
        return;
      }
      setAppSettings({ shortcuts: { ...settings.shortcuts, [recording]: shortcut } });
      setRecording(null);
      setShortcutError("");
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [recording, settings.shortcuts]);
  return (
    <div className="h-full overflow-y-auto">
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link to="/" className="mb-2 inline-block text-sm text-blue-700 hover:underline">← HOME</Link>
          <h2 className="text-lg font-semibold">설정</h2>
          <p className="mt-1 text-sm text-gray-500">변경 사항은 즉시 적용되고 이 기기에 저장됩니다.</p>
        </div>
        <button type="button" onClick={resetAppSettings} className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">기본값 복원</button>
      </div>

      <section aria-labelledby="appearance-heading" className="rounded-lg border border-gray-200 bg-white p-5">
        <h3 id="appearance-heading" className="mb-4 font-semibold">화면</h3>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="text-sm">
            <span className="font-medium">테마</span>
            <select aria-label="테마" value={settings.theme} onChange={(event) => setAppSettings({ theme: event.target.value as AppTheme })} className={selectClass}>
              <option value="system">시스템 설정</option>
              <option value="light">밝게</option>
              <option value="dark">어둡게</option>
            </select>
          </label>

          <label className="text-sm">
            <span className="font-medium">폰트</span>
            <select aria-label="폰트" value={settings.font} onChange={(event) => setAppSettings({ font: event.target.value as typeof settings.font })} className={selectClass}>
              {appFonts.map((font) => <option key={font.value} value={font.value}>{font.label}</option>)}
            </select>
          </label>

          <label className="text-sm">
            <span className="font-medium">폰트 크기</span>
            <select aria-label="폰트 크기" value={settings.fontSize} onChange={(event) => setAppSettings({ fontSize: Number(event.target.value) })} className={selectClass}>
              {appFontSizes.map((size) => <option key={size} value={size}>{size}px</option>)}
            </select>
          </label>
        </div>

        <div className="mt-5 rounded border border-gray-200 bg-gray-50 p-3">
          <p className="text-sm">화면 미리보기</p>
          <code className="mt-2 block">SELECT * FROM sample_table;</code>
        </div>
      </section>

      <section aria-labelledby="ai-heading" className="mt-5 rounded-lg border border-gray-200 bg-white p-5">
        <h3 id="ai-heading" className="font-semibold">AI</h3>
        <p className="mt-1 text-sm text-gray-500">Claude Code 또는 Codex 구독형 CLI를 사용합니다. API 키를 저장하지 않습니다.</p>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <label className="text-sm"><span className="font-medium">LLM 프로바이더</span>
            <select aria-label="LLM 프로바이더" value={settings.aiProvider} onChange={(e) => { const provider = e.target.value as AiProvider; setAppSettings({ aiProvider: provider, aiModel: aiModels[provider][0] }); }} className={selectClass}>
              <option value="claude">Claude Code</option><option value="codex">Codex</option>
            </select>
          </label>
          <label className="text-sm"><span className="font-medium">기본 모델</span>
            <select aria-label="기본 AI 모델" value={settings.aiModel} onChange={(e) => setAppSettings({ aiModel: e.target.value })} className={selectClass}>
              {aiModels[settings.aiProvider].map((model) => <option key={model} value={model}>{model}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section aria-labelledby="shortcuts-heading" className="mt-5 rounded-lg border border-gray-200 bg-white p-5">
        <h3 id="shortcuts-heading" className="font-semibold">단축키</h3>
        <p className="mt-1 text-sm text-gray-500">단축키 버튼을 선택한 뒤 사용할 키 조합을 누르세요.</p>
        {shortcutError && <p role="alert" className="mt-2 text-sm text-red-600">{shortcutError}</p>}
        <div className="mt-4 divide-y divide-gray-200">
          {shortcutDefinitions.map(({ id, label }) => (
            <div key={id} className="flex items-center justify-between gap-4 py-2">
              <span className="text-sm">{label}</span>
              <button
                type="button"
                aria-label={`${label} 단축키`}
                onClick={() => { setRecording(id); setShortcutError(""); }}
                className={`min-w-36 rounded border px-3 py-1.5 text-right font-mono text-sm ${recording === id ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500" : "border-gray-300 hover:bg-gray-50"}`}
              >
                {recording === id ? "새 단축키 입력…" : displayShortcut(settings.shortcuts[id])}
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
    </div>
  );
}
