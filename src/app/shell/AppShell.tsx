import { getCurrentWindow } from "@tauri-apps/api/window";
import { editStore } from "../../entities/result/editStore";
import { resultIds, workspaceStates } from "../../entities/workspace/workspaceStore";
import { ipc } from "../../shared/ipc/invoke";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getPersistenceError, saveWorkspaceNow, subscribePersistence } from "../../entities/workspace/persistence";
import { Link, Outlet, useParams } from "@tanstack/react-router";
import { useOpenConnections } from "../../entities/connection/openConnections";
import { environmentStyles } from "../../entities/connection/environmentStyles";
import { AIChatPanel } from "../../features/ai/AIChatPanel";
import { getAppSettings } from "../../entities/settings/appSettings";
import { shortcutMatches } from "../../entities/settings/shortcuts";

function ConnectionRail() {
  const connections = useOpenConnections();
  const params = useParams({ strict: false }) as { connectionId?: string };
  if (connections.length === 0) return null;
  return (
    <nav aria-label="열린 연결" className="flex w-12 shrink-0 flex-col items-center gap-2 border-r border-gray-200 bg-gray-50 py-2">
      <Link
        to="/"
        activeOptions={{ exact: true }}
        title="HOME — 연결은 유지됩니다"
        aria-label="HOME"
        className={`flex h-11 w-10 flex-col items-center justify-center gap-0.5 rounded hover:bg-gray-200 ${params.connectionId ? "text-gray-600" : "bg-blue-50 text-blue-700"}`}
      >
        <span aria-hidden="true" className="text-xl leading-none">⌂</span>
        <span className="text-[10px]">HOME</span>
      </Link>
      {connections.map(([id, p]) => (
        <Link
          key={id}
          to="/workspace/$connectionId"
          params={{ connectionId: id }}
          title={`${p.name} / ${p.database} (${p.environment})`}
          aria-label={`${p.name} / ${p.database}`}
          className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white ${
            environmentStyles[p.environment].rail
          } ${params.connectionId === id ? "ring-2 ring-blue-500 ring-offset-1" : "opacity-70 hover:opacity-100"}`}
        >
          {p.name.slice(0, 2).toUpperCase()}
        </Link>
      ))}
      <Link
        to="/"
        title="연결 추가"
        aria-label="연결 추가"
        className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-gray-400 text-gray-500 hover:bg-gray-200"
      >
        +
      </Link>
    </nav>
  );
}

export function AppShell() {
  const [closeError, setCloseError] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [aiWidth, setAiWidth] = useState(384);
  const aiResizeStart = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  const params = useParams({ strict: false }) as { connectionId?: string };
  const connections = useOpenConnections();
  const workspaceOpen = Boolean(params.connectionId && connections.some(([id]) => id === params.connectionId));
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat) return;
      const shortcuts = getAppSettings().shortcuts;
      if (shortcutMatches(event, shortcuts.openSettings)) {
        event.preventDefault();
        document.querySelector<HTMLAnchorElement>('a[aria-label="설정"]')?.click();
        return;
      }
      if (!workspaceOpen || !shortcutMatches(event, shortcuts.toggleAi)) return;
      event.preventDefault();
      setAiOpen((open) => !open);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [workspaceOpen]);
  useEffect(() => {
    const preventBackspaceNavigation = (event: KeyboardEvent) => {
      // The macOS window-close accelerator is removed natively. Keep Cmd+W
      // inert outside a workspace so only Cmd+Q exits the application.
      if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "w") {
        event.preventDefault();
        return;
      }
      if (event.key !== "Backspace") return;
      const field = event.target instanceof Element ? event.target.closest("input, textarea, [contenteditable]") : null;
      const editable = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement
        ? !field.readOnly && !field.matches(":disabled") && (field instanceof HTMLTextAreaElement
          || /^(text|search|email|url|tel|password|number|date|time|datetime-local|month|week)$/.test(field.type))
        : field instanceof HTMLElement && (field.isContentEditable
          || ["", "true", "plaintext-only"].includes(field.getAttribute("contenteditable") ?? "false"));
      if (!editable) event.preventDefault();
    };
    window.addEventListener("keydown", preventBackspaceNavigation, true);
    return () => window.removeEventListener("keydown", preventBackspaceNavigation, true);
  }, []);
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let disposed = false;
    let closing = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();
      if (closing) return;
      const tabs = [...workspaceStates.values()].flatMap((state) => state.tabs);
      if (tabs.some((tab) => tab.runningExecutionId?.startsWith("pending:") || resultIds(tab).some((id) => editStore.getSnapshot(id).locked))) {
        setCloseError("실행 준비 또는 저장이 완료된 후 앱을 닫아 주세요.");
        return;
      }
      if (tabs.some((tab) => tab.runningExecutionId || (tab.transactionState && tab.transactionState !== "idle") || resultIds(tab).some((id) => editStore.getSnapshot(id).pendingCount)) || document.querySelector('[aria-label="셀 편집"]')) {
        if (!window.confirm("저장하지 않은 편집을 버리고, 실행 중인 쿼리를 취소하며 열린 트랜잭션을 롤백한 후 종료할까요?")) return;
      }
      closing = true;
      try {
        await saveWorkspaceNow();
        for (const connectionId of workspaceStates.keys()) await ipc.connectionClose({ connectionId });
        await getCurrentWindow().destroy();
      } catch (error) {
        setCloseError((error as Error).message ?? String(error));
        closing = false;
      }
    }).then((off) => { if (disposed) off(); else unlisten = off; }).catch((error: unknown) => {
      if (!disposed) setCloseError((error as Error).message ?? String(error));
    });
    return () => { disposed = true; unlisten?.(); };
  }, []);
  const persistenceError = useSyncExternalStore(subscribePersistence, getPersistenceError);
  return (
    <div className="flex h-screen flex-col bg-white text-gray-900">
      <header className="flex shrink-0 items-center border-b border-gray-200 px-3 py-1.5">
        <Link to="/" aria-label="DBPod HOME" title="HOME" className="rounded hover:text-blue-700">
          <h1 className="text-sm font-semibold tracking-tight">DBPod</h1>
        </Link>
        <span className="ml-2 text-xs text-gray-400">PostgreSQL client — MVP</span>
        <Link
          to="/settings"
          title="설정"
          aria-label="설정"
          className="ml-auto rounded px-2 py-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
        >
          <span aria-hidden="true" className="text-xl leading-none">⚙</span>
        </Link>
        {workspaceOpen && <button type="button" onClick={() => setAiOpen((open) => !open)} aria-pressed={aiOpen} className="ml-2 rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-800">AI</button>}
      </header>
      {closeError && <div role="alert" className="bg-amber-50 px-3 py-2 text-sm text-amber-800">종료하지 못했습니다: {closeError}</div>}
      {persistenceError && <div role="alert" className="bg-red-50 px-3 py-2 text-sm text-red-800">{persistenceError} · 현재 초안은 메모리에 유지됩니다. 앱을 닫기 전에 복사해 두세요.</div>}
      <div className="flex min-h-0 flex-1">
        <ConnectionRail />
        <main className="min-h-0 min-w-0 flex-1">
          <Outlet />
        </main>
        {aiOpen && <>
          <div
            role="separator"
            aria-label="AI 패널 너비 조절"
            aria-orientation="vertical"
            aria-valuemin={280}
            aria-valuemax={640}
            aria-valuenow={aiWidth}
            tabIndex={0}
            title="드래그로 AI 패널 너비 조절"
            hidden={!workspaceOpen}
            className="w-1.5 shrink-0 cursor-col-resize touch-none select-none bg-gray-200 hover:bg-blue-300 focus-visible:bg-blue-400 focus-visible:outline-none active:bg-blue-400"
            onPointerDown={(event) => {
              if (event.button !== 0 || event.isPrimary === false) return;
              event.preventDefault();
              event.currentTarget.focus();
              event.currentTarget.setPointerCapture(event.pointerId);
              aiResizeStart.current = { pointerId: event.pointerId, x: event.clientX, width: aiWidth };
            }}
            onPointerMove={(event) => {
              const start = aiResizeStart.current;
              if (!start || start.pointerId !== event.pointerId || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
              setAiWidth(Math.max(280, Math.min(640, start.width - event.clientX + start.x)));
            }}
            onPointerUp={() => { aiResizeStart.current = null; }}
            onPointerCancel={() => { aiResizeStart.current = null; }}
            onLostPointerCapture={() => { aiResizeStart.current = null; }}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              setAiWidth((width) => event.key === "Home" ? 280 : event.key === "End" ? 640 : Math.max(280, Math.min(640, width + (event.key === "ArrowLeft" ? 16 : -16))));
            }}
          />
          <AIChatPanel width={aiWidth} visible={workspaceOpen} onClose={() => setAiOpen(false)} />
        </>}
      </div>
    </div>
  );
}
