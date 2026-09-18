import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Channel } from "@tauri-apps/api/core";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import hljs from "highlight.js/lib/core";
import sqlLanguage from "highlight.js/lib/languages/sql";

import { aiSessionStore, useAiSessions } from "../../entities/ai/aiSessionStore";
import { aiModels, useAppSettings, type AiProvider } from "../../entities/settings/appSettings";
import { displayShortcut, shortcutMatches } from "../../entities/settings/shortcuts";
import { AiChatEvent, type AiSessionSnapshot } from "../../generated/ipc-types";
import { ipc } from "../../shared/ipc/invoke";

hljs.registerLanguage("sql", sqlLanguage);

type Message = { role: "user" | "assistant"; text: string; at: number };
type Approval = { approvalId: number; message: string; detail: string | null };
const formatTime = (at: number) => new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(at);
const formatDay = (iso: string) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const newId = () => typeof crypto?.randomUUID === "function"
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
// Every CLI eventually forgets a session; the message is the only way to tell.
const sessionExpired = (error: unknown) =>
  /no conversation found|conversation not found|session not found|thread not found/i
    .test((error as { message?: string })?.message ?? String(error));
const highlightCode = (code: string, className: string) => {
  const language = className.replace(/^language-/, "");
  return (hljs.getLanguage(language) ? hljs.highlight(code, { language }) : hljs.highlightAuto(code)).value;
};

function MessageBubble({ message, copied, onCopied }: { message: Message; copied: boolean; onCopied: () => void }) {
  const copy = () => { void navigator.clipboard.writeText(message.text).then(onCopied); };
  return <div className={`group ${message.role === "user" ? "ml-auto w-fit max-w-[90%]" : "mr-2"}`}>
    <div className={message.role === "user" ? "rounded-xl bg-blue-50 p-2" : ""}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="mb-2 list-disc pl-4">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 list-decimal pl-4">{children}</ol>,
          h1: ({ children }) => <h1 className="mb-2 text-base font-semibold">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 text-sm font-semibold">{children}</h2>,
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children, ...props }) => className
            ? <div className="my-3 overflow-hidden rounded-xl border border-slate-600 bg-slate-800 text-gray-100 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-600 px-3 py-1.5 text-[10px] text-gray-300"><span>{className.replace(/^language-/, "")}</span><button type="button" aria-label="코드 복사" onClick={() => { void navigator.clipboard.writeText(String(children).replace(/\n$/, "")); }} className="hover:text-white">코드 복사</button></div>
              <pre className="overflow-x-auto p-3"><code className="hljs font-mono" {...props} dangerouslySetInnerHTML={{ __html: highlightCode(String(children).replace(/\n$/, ""), className) }} /></pre>
            </div>
            : <code className="rounded bg-gray-200 px-1 py-0.5 font-mono text-[0.9em]" {...props}>{children}</code>,
        }}
      >
        {message.text}
      </Markdown>
    </div>
    <div className={`flex items-center gap-2 text-[10px] text-gray-400 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${message.role === "user" ? "justify-end" : "justify-start"}`}>
      <button type="button" aria-label={`${message.role === "user" ? "질문" : "답변"} 복사`} title={copied ? "복사됨" : "복사"} onClick={copy} className="hover:text-blue-600">복사</button>
      <time dateTime={new Date(message.at).toISOString()}>{formatTime(message.at)}</time>
    </div>
  </div>;
}

export function AIChatPanel({ onClose, width, visible = true }: { onClose: () => void; width: number; visible?: boolean }) {
  const settings = useAppSettings();
  const [provider, setProvider] = useState<AiProvider>(settings.aiProvider);
  const [model, setModel] = useState(settings.aiModel);
  const [thinking, setThinking] = useState("auto");
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const [progress, setProgress] = useState("");
  // Codex blocks its turn until each of these is answered.
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const sessions = useAiSessions();
  // Our own conversation key, distinct from the CLI handle it may outlive.
  const conversationId = useRef(newId());
  // The CLI owns the transcript; this is only the handle used to resume it.
  const sessionId = useRef<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  // A textarea only reports its content height once the height cap is lifted.
  useLayoutEffect(() => {
    const element = promptRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [prompt]);

  useEffect(() => {
    const element = messagesRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages, busy, prompt]);

  useEffect(() => {
    if (busy || messages.length === 0) return;
    aiSessionStore.upsert({ id: conversationId.current, provider, model, cliSessionId: sessionId.current, messages });
  }, [busy, messages, provider, model]);

  const newConversation = () => {
    if (busy) return;
    conversationId.current = newId();
    sessionId.current = null;
    setMessages([]);
    setShowHistory(false);
  };

  const restore = (session: AiSessionSnapshot) => {
    if (busy) return;
    conversationId.current = session.id;
    sessionId.current = session.cliSessionId;
    setProvider(session.provider === "codex" ? "codex" : "claude");
    setModel(session.model);
    setMessages(session.messages.map((m) => ({ role: m.role === "user" ? "user" as const : "assistant" as const, text: m.text, at: m.at })));
    setShowHistory(false);
  };

  const send = async () => {
    const text = prompt.trim();
    if (!text || busy) return;

    setPrompt("");
    setMessages((current) => [...current, { role: "user", text, at: Date.now() }]);
    setBusy(true);
    setProgress("시작 중…");
    setApprovals([]);

    const runTurn = async () => {
      let response = "";
      const runningRequestId = newId();
      setRequestId(runningRequestId);
      const channel = new Channel<AiChatEvent>();
      channel.onmessage = (event) => {
        if (event.type === "session" && event.id) sessionId.current = event.id;
        if (event.type === "approval") setApprovals((current) => [...current, { approvalId: event.approvalId, message: event.message, detail: event.detail }]);
        if (event.type === "progress" && event.text) setProgress(event.text);
        if (event.type === "chunk" && event.text) {
          response += event.text;
          setProgress("");
          flushSync(() => {
            setMessages((current) => {
              const last = current[current.length - 1];
              return last?.role === "assistant"
                ? [...current.slice(0, -1), { ...last, text: response }]
                : [...current, { role: "assistant", text: response, at: Date.now() }];
            });
          });
        }
        if (event.type === "failed" && event.message) {
          setMessages((current) => [...current, { role: "assistant", text: `오류: ${event.message}`, at: Date.now() }]);
        }
      };

        await ipc.aiChat({ provider, model, thinking, prompt: text, requestId: runningRequestId, sessionId: sessionId.current }, channel);
    };

    try {
      try {
        await runTurn();
      } catch (error) {
        // A restored conversation outlives the CLI session behind it. Retrying
        // once loses the earlier context but spares retyping the question.
        if (!sessionId.current || !sessionExpired(error)) throw error;
        sessionId.current = null;
        setMessages((current) => [...current, { role: "assistant", text: "이전 대화 맥락이 만료되어 새 세션으로 이어갑니다.", at: Date.now() }]);
        await runTurn();
      }
    } catch (error) {
      setMessages((current) => [...current, { role: "assistant", text: `오류: ${(error as Error).message ?? String(error)}`, at: Date.now() }]);
    } finally {
      setBusy(false);
      setProgress("");
      setRequestId(null);
      setApprovals([]);
    }
  };

  const answerApproval = async (approval: Approval, approved: boolean) => {
    const runningId = requestId;
    setApprovals((current) => current.filter((item) => item.approvalId !== approval.approvalId));
    if (!runningId) return;
    try {
      await ipc.aiChatApprove({ requestId: runningId, approvalId: approval.approvalId, approved });
    } catch {
      // The turn is already finished or cancelled; nothing is left to answer.
    }
  };

  const cancel = async () => {
    const runningId = requestId;
    if (!runningId) return;
    setProgress("중단 중…");
    try {
      await ipc.aiChatCancel({ requestId: runningId });
    } catch {
      // 폴백은 진행 상태만 정리해서 최소한 즉시 UI를 멈춘다.
    }
  };

  return <aside hidden={!visible} style={{ width }} className="flex shrink-0 flex-col border-l border-gray-200 bg-white" aria-label="AI 채팅 패널">
    <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-3 py-2">
      <strong className="text-sm">{showHistory ? "대화 기록" : "AI Chat"}</strong>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => setShowHistory((open) => !open)} disabled={busy} aria-label="대화 기록" aria-pressed={showHistory} title="대화 기록" className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-40">{showHistory ? "←" : "☰"}</button>
        <button type="button" onClick={newConversation} disabled={busy || messages.length === 0} aria-label="새 대화" title="새 대화 — 지금까지의 맥락을 잊습니다" className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-40">새 대화</button>
        <button type="button" onClick={onClose} aria-label="AI 채팅 닫기" className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100">×</button>
      </div>
    </div>
    {showHistory ? (
      <div className="min-h-0 flex-1 overflow-y-auto" role="list" aria-label="저장된 대화">
        {sessions.length === 0 && <p className="p-3 text-xs text-gray-400">저장된 대화가 없습니다.</p>}
        {sessions.map((session) => (
          <div key={session.id} role="listitem" className="flex items-start gap-1 border-b border-gray-100 hover:bg-gray-50">
            <button type="button" onClick={() => restore(session)} className="min-w-0 flex-1 px-3 py-2 text-left">
              <span className="block truncate text-xs text-gray-800">{session.title}</span>
              <span className="mt-0.5 block text-[10px] text-gray-400">{formatDay(session.updatedAt)} · {session.provider}/{session.model} · {session.messages.length}개</span>
            </button>
            <button type="button" onClick={() => aiSessionStore.remove(session.id)} aria-label={`${session.title} 삭제`} className="shrink-0 px-2 py-2 text-gray-300 hover:text-red-600">×</button>
          </div>
        ))}
      </div>
    ) : (
    <div ref={messagesRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
      {messages.length === 0 && <p className="text-xs text-gray-400">명령을 입력하면 선택한 CLI에 그대로 전달합니다.</p>}
      {messages.map((message, index) => <MessageBubble key={index} message={message} copied={copied === index} onCopied={() => { setCopied(index); window.setTimeout(() => setCopied((current) => current === index ? null : current), 1200); }} />)}
      {approvals.map((approval) => (
        <div key={approval.approvalId} role="alertdialog" aria-label="도구 실행 승인" className="rounded-xl border border-amber-300 bg-amber-50 p-2 text-xs">
          <p className="font-medium text-amber-900">{approval.message}</p>
          {approval.detail && <p className="mt-1 text-amber-800">{approval.detail}</p>}
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => void answerApproval(approval, true)} className="rounded bg-amber-600 px-2 py-1 text-white hover:bg-amber-700">허용</button>
            <button type="button" onClick={() => void answerApproval(approval, false)} className="rounded border border-amber-400 px-2 py-1 text-amber-900 hover:bg-amber-100">거부</button>
          </div>
        </div>
      ))}
      {busy && approvals.length === 0 && <p className="text-xs text-gray-400">{progress || "응답 중…"}</p>}
    </div>
    )}
      <div className="shrink-0 border-t-2 border-gray-200 p-2">
        <div className="rounded border border-gray-300 bg-white focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500">
          <textarea autoFocus aria-label="AI 명령" value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { if (shortcutMatches(e, settings.shortcuts.aiSend)) { e.preventDefault(); void send(); } }} placeholder="AI에게 명령 입력…" ref={promptRef} className="block max-h-[40vh] min-h-16 w-full resize-none overflow-y-auto border-0 bg-transparent p-2 text-xs outline-none focus:ring-0" />
          <div className="flex items-center gap-1 px-2 pb-2">
            <select aria-label="AI 프로바이더" value={provider} onChange={(e) => {
              const next = e.target.value as AiProvider;
              // A session handle belongs to the CLI that issued it.
              if (next !== provider) sessionId.current = null;
              setProvider(next);
              setModel(aiModels[next][0]);
            }} className="min-w-0 rounded border border-gray-300 px-1 py-1 text-xs">
              <option value="claude">Claude</option>
              <option value="codex">Codex</option>
            </select>
            <select aria-label="AI 모델" value={model} onChange={(e) => setModel(e.target.value)} className="min-w-0 flex-1 rounded border border-gray-300 px-1 py-1 text-xs">
              {aiModels[provider].map((item) => <option key={item}>{item}</option>)}
            </select>
            <select aria-label="사고 단계" value={thinking} onChange={(e) => setThinking(e.target.value)} className="min-w-0 rounded border border-gray-300 px-1 py-1 text-xs">
              {(provider === "claude" ? ["auto", "low", "medium", "high"] : ["auto", "low", "medium", "high", "xhigh"]).map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            {busy ? (
              <button type="button" onClick={() => void cancel()} aria-label="AI 응답 중단" title="AI 응답 중단" className="ml-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-500 text-lg leading-none text-white">■</button>
            ) : (
              <button type="button" onClick={() => void send()} disabled={!prompt.trim()} aria-label="전송" title={`전송 (${displayShortcut(settings.shortcuts.aiSend)})`} className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-lg leading-none text-white disabled:opacity-40">↑</button>
            )}
          </div>
        </div>
      </div>
  </aside>;
}
