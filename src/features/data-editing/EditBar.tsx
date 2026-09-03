import { useCallback, useState, useSyncExternalStore } from "react";
import { editStore } from "../../entities/result/editStore";
import { resultStore } from "../../entities/result/resultStore";
import type { ChangesPreviewResponse, RowConflict } from "../../generated/ipc-types";
import { ipc } from "../../shared/ipc/invoke";
import type { Editability, EditableInfo } from "./editability";
import { applyServerValues, buildRowChanges, commitChangeSet } from "./saveChanges";

function Dialog({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" role="dialog" aria-modal="true">
      <div className="max-h-[80vh] w-[560px] max-w-[90vw] overflow-auto rounded-lg bg-white p-4 shadow-xl">
        {children}
      </div>
    </div>
  );
}

export function EditBar({
  connectionId,
  resultTabId,
  editability,
}: {
  connectionId: string;
  resultTabId: string;
  editability: Editability;
}) {
  const edits = useSyncExternalStore(
    useCallback((cb: () => void) => editStore.subscribe(resultTabId, cb), [resultTabId]),
    () => editStore.getSnapshot(resultTabId),
  );
  const [preview, setPreview] = useState<ChangesPreviewResponse | null>(null);
  const [conflicts, setConflicts] = useState<RowConflict[] | null>(null);
  const [message, setMessage] = useState("");
  const [showValues, setShowValues] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!editability.editable) {
    return (
      <div className="shrink-0 border-b border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-500">
        읽기 전용: {editability.reason}
      </div>
    );
  }
  const info: EditableInfo = editability;

  const openPreview = async () => {
    setMessage("");
    setBusy(true);
    try {
      const changes = buildRowChanges(info, resultStore.getSnapshot(resultTabId), edits);
      const resp = await ipc.changesPreview({
        connectionId,
        resultTabId,
        relationOid: info.relationOid,
        changes,
      });
      setPreview(resp);
    } catch (e) {
      const err = e as { message?: string };
      setMessage(`검증 실패: ${err?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!preview) return;
    if (
      preview.counts.delete >= 10 &&
      !window.confirm(`${preview.counts.delete}개 행을 삭제합니다. 계속할까요?`)
    )
      return;
    setBusy(true);
    try {
      const outcome = await commitChangeSet(resultTabId, preview.changeSetId, info);
      setPreview(null);
      if (outcome.type === "completed") {
        setMessage(`저장됨: ${outcome.rowCount}행 반영`);
      } else if (outcome.type === "conflict") {
        setConflicts(outcome.conflicts);
      } else {
        setMessage(`저장 실패(전체 롤백됨): ${outcome.message}`);
      }
    } catch (e) {
      setPreview(null);
      const err = e as { message?: string };
      setMessage(`저장 실패: ${err?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const cancelPreview = () => {
    if (preview) void ipc.changesDiscard({ changeSetId: preview.changeSetId }).catch(() => undefined);
    setPreview(null);
    setShowValues(false);
  };

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 bg-amber-50/60 px-3 py-1 text-xs">
        {info.lockMode === "displayed" && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800" title="xmin이 없어 표시된 컬럼 값으로 충돌을 감지합니다">
            displayed columns conflict check
          </span>
        )}
        <span className="text-gray-600">
          {edits.pendingCount > 0 ? `변경 ${edits.pendingCount}건 대기 중` : "편집 가능 (더블클릭)"}
        </span>
        {message && <span className="text-gray-700">{message}</span>}
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            disabled={edits.pendingCount === 0 || busy}
            onClick={() => void openPreview()}
            className="rounded bg-green-600 px-3 py-0.5 text-white hover:bg-green-700 disabled:opacity-40"
          >
            저장…
          </button>
          <button
            type="button"
            disabled={edits.pendingCount === 0 || busy}
            onClick={() => {
              if (window.confirm("대기 중인 변경을 모두 취소할까요?")) editStore.clear(resultTabId);
            }}
            className="rounded border border-gray-300 px-3 py-0.5 text-gray-600 hover:bg-gray-100 disabled:opacity-40"
          >
            변경 취소
          </button>
        </div>
      </div>

      {preview && (
        <Dialog>
          <h3 className="mb-2 text-sm font-semibold">변경 사항 저장 — SQL Preview</h3>
          <p className="mb-2 text-xs text-gray-600">
            {preview.target.schema}.{preview.target.table} · 하나의 트랜잭션으로{" "}
            {preview.counts.delete > 0 && `DELETE ${preview.counts.delete} · `}
            {preview.counts.update > 0 && `UPDATE ${preview.counts.update} · `}
            {preview.counts.insert > 0 && `INSERT ${preview.counts.insert}`}
          </p>
          {preview.warnings.map((w) => (
            <p key={w} className="mb-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
              {w}
            </p>
          ))}
          <div className="mb-3 flex max-h-64 flex-col gap-1 overflow-auto">
            {preview.statements.map((s, i) => (
              <pre key={i} className="whitespace-pre-wrap break-all rounded bg-gray-50 p-2 text-[11px] text-gray-800">
                {`-- ${s.operation} × ${s.rowCount}\n${s.sqlTemplate}`}
              </pre>
            ))}
          </div>
          <label className="mb-3 flex items-center gap-1 text-xs text-gray-500">
            <input type="checkbox" checked={showValues} onChange={(e) => setShowValues(e.target.checked)} />
            값 표시 (화면에만 표시, 로그·클립보드 저장 안 함)
          </label>
          {showValues && (
            <p className="mb-3 rounded bg-gray-50 p-2 text-xs text-gray-600">
              대기 중 변경 {edits.pendingCount}건 — 셀의 하이라이트 값이 그대로 bind parameter로 전달됩니다.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={cancelPreview} className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50">
              취소
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void commit()}
              className="rounded bg-green-600 px-3 py-1 text-sm text-white hover:bg-green-700 disabled:opacity-50"
            >
              트랜잭션으로 저장
            </button>
          </div>
        </Dialog>
      )}

      {conflicts && (
        <Dialog>
          <h3 className="mb-2 text-sm font-semibold">저장 충돌 — 자동 덮어쓰기 없음</h3>
          <p className="mb-2 text-xs text-gray-600">
            다른 세션이 아래 행을 변경했거나 삭제했습니다. 전체 트랜잭션이 롤백되었고 편집 내용은 유지됩니다.
          </p>
          <ul className="mb-3 max-h-48 overflow-auto text-xs">
            {conflicts.map((c) => (
              <li key={c.rowId} className="mb-1 rounded bg-red-50 px-2 py-1">
                행 {c.rowId}: {c.current ? "서버 값이 변경됨" : "서버에서 삭제됨"}
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2 text-sm">
            <button
              type="button"
              onClick={() => {
                applyServerValues(resultTabId, conflicts, info);
                setConflicts(null);
              }}
              className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50"
              title="충돌 행을 최신 서버 값으로 갱신하고 해당 draft를 제거합니다"
            >
              서버 값 사용
            </button>
            <button
              type="button"
              onClick={() => setConflicts(null)}
              className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50"
            >
              계속 편집
            </button>
            <button
              type="button"
              onClick={() => {
                editStore.clear(resultTabId);
                setConflicts(null);
              }}
              className="rounded border border-red-300 px-3 py-1 text-red-600 hover:bg-red-50"
            >
              모두 취소
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
