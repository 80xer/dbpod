import { useNavigate, useParams } from "@tanstack/react-router";
import type { EditorView } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import { openConnections } from "../../entities/connection/openConnections";
import { resultStore } from "../../entities/result/resultStore";
import { SqlEditor } from "../../features/query-editor/SqlEditor";
import { statementAt } from "../../features/query-editor/statementSplitter";
import { ResultGrid } from "../../features/result-grid/ResultGrid";
import { ipc } from "../../shared/ipc/invoke";
import { runQuery } from "../../shared/ipc/queryChannel";

export function WorkspacePage() {
  const { connectionId } = useParams({ from: "/workspace/$connectionId" });
  const navigate = useNavigate();
  const profile = openConnections.get(connectionId);

  const [queryTabId] = useState(() => crypto.randomUUID());
  const [resultTabId] = useState(() => crypto.randomUUID());
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState("");
  const viewRef = useRef<EditorView | null>(null);
  const executionRef = useRef<string | null>(null);
  const sessionRef = useRef<string | null>(null);

  // Tab/connection teardown: cancel -> close session (rollback) -> free rows.
  useEffect(() => {
    return () => {
      const sessionId = sessionRef.current;
      if (executionRef.current) void ipc.queryCancel({ executionId: executionRef.current });
      if (sessionId)
        void ipc.querySessionClose({ sessionId, rollbackOpenTransaction: true });
      void ipc.resultRelease({ resultTabId });
      resultStore.dispose(resultTabId);
    };
  }, [resultTabId]);

  useEffect(() => {
    if (!profile) void navigate({ to: "/" });
  }, [profile, navigate]);
  if (!profile) return null;

  const pickSql = (): string | null => {
    const view = viewRef.current;
    if (!view) return null;
    const { from, to } = view.state.selection.main;
    if (from !== to) return view.state.sliceDoc(from, to).trim() || null;
    return statementAt(view.state.doc.toString(), from)?.sql ?? null;
  };

  const run = async () => {
    if (running) return;
    const sql = pickSql();
    if (!sql) {
      setNotice("실행할 SQL이 없습니다.");
      return;
    }
    setNotice("");
    setRunning(true);
    try {
      const accepted = await runQuery({
        connectionId,
        queryTabId,
        resultTabId,
        sql,
        maxRows: profile.maxRows || 500,
        timeoutMs: profile.queryTimeoutMs || 60_000,
      });
      executionRef.current = accepted.executionId;
      sessionRef.current = accepted.sessionId;
      // Wait for the terminal state via the store.
      const unsubscribe = resultStore.subscribe(resultTabId, () => {
        const s = resultStore.getSnapshot(resultTabId);
        if (s.status !== "running" && s.status !== "idle") {
          executionRef.current = null;
          setRunning(false);
          unsubscribe();
        }
      });
    } catch (e) {
      setRunning(false);
      const err = e as { message?: string };
      setNotice(err?.message ?? String(e));
    }
  };

  const cancel = () => {
    if (executionRef.current) void ipc.queryCancel({ executionId: executionRef.current });
  };

  const disconnect = async () => {
    await ipc.connectionClose({ connectionId }).catch(() => undefined);
    openConnections.delete(connectionId);
    void navigate({ to: "/" });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 px-3 py-1.5">
        <span className="text-sm font-medium">{profile.name}</span>
        <span className="text-xs text-gray-500">
          {profile.username}@{profile.host}/{profile.database}
        </span>
        {profile.readOnly && (
          <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">읽기 전용</span>
        )}
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
          TLS {profile.tlsMode}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => void run()}
            disabled={running}
            className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
            title="Cmd/Ctrl+Enter"
          >
            ▶ 실행
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={!running}
            className="rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50 disabled:opacity-40"
            title="Esc 또는 Cmd/Ctrl+."
          >
            ■ 중지
          </button>
          <button
            type="button"
            onClick={() => void disconnect()}
            className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
          >
            연결 종료
          </button>
        </div>
      </div>
      {notice && <div className="bg-amber-50 px-3 py-1 text-xs text-amber-800">{notice}</div>}
      <div className="min-h-0 flex-1 basis-2/5 overflow-hidden">
        <SqlEditor
          initialSql=""
          onRun={() => void run()}
          onCancel={cancel}
          onViewReady={(v) => {
            viewRef.current = v;
          }}
        />
      </div>
      <div className="min-h-0 flex-1 basis-3/5">
        <ResultGrid resultTabId={resultTabId} />
      </div>
    </div>
  );
}
