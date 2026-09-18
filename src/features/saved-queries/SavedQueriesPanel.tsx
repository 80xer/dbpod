import { useState } from "react";
import { savedQueryStore, useSavedQueries } from "../../entities/query/savedQueryStore";
import type { SavedQuery } from "../../generated/ipc-types";
import { confirmDialog, promptText } from "../../shared/ui/prompt";

type Props = {
  /** Saving lives in the workspace, which owns the tab the query belongs to. */
  onSaveCurrent: () => void;
  saveShortcut: string;
  onOpen: (entry: SavedQuery) => void;
  onClose: () => void;
};

export function SavedQueriesPanel({ onSaveCurrent, saveShortcut, onOpen, onClose }: Props) {
  const all = useSavedQueries();
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const needle = filter.trim().toLowerCase();
  const entries = needle
    ? all.filter((e) => e.name.toLowerCase().includes(needle) || e.sql.toLowerCase().includes(needle))
    : all;

  const attempt = (run: () => Promise<unknown>) => {
    setError("");
    void run().catch((e: unknown) => setError((e as { message?: string }).message ?? String(e)));
  };

  return (
    <div className="flex w-72 shrink-0 flex-col border-l border-gray-200 bg-gray-50">
      <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 px-2 py-1.5">
        <span className="text-xs font-semibold">저장된 쿼리</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="저장된 쿼리 닫기"
          className="ml-auto rounded px-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
        >
          ×
        </button>
      </div>
      <div className="shrink-0 space-y-1.5 p-2">
        <button
          type="button"
          onClick={onSaveCurrent}
          title={`현재 쿼리 저장 — ${saveShortcut}`}
          className="w-full rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700"
        >
          현재 쿼리 저장 ({saveShortcut})
        </button>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="이름 또는 SQL 검색"
          aria-label="저장된 쿼리 검색"
          className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
        />
      </div>
      {error && (
        <div role="alert" className="shrink-0 px-2 pb-1 text-[11px] text-red-600">
          {error}
        </div>
      )}
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {entries.length === 0 && (
          <li className="py-2 text-xs text-gray-400">
            {all.length === 0 ? "저장된 쿼리가 없습니다" : "검색 결과가 없습니다"}
          </li>
        )}
        {entries.map((e) => (
          <li key={e.id} className="group mb-1 rounded border border-gray-200 bg-white p-1.5">
            <button
              type="button"
              onClick={() => onOpen(e)}
              title="새 쿼리 탭에서 열기"
              className="block w-full truncate text-left text-xs font-medium text-gray-800 hover:text-blue-700"
            >
              {e.name}
            </button>
            <div className="truncate font-mono text-[10px] text-gray-500">{e.sql}</div>
            <div className="mt-0.5 flex items-center gap-1 text-[10px] text-gray-400">
              <span>{new Date(e.updatedAt).toLocaleString()}</span>
              <button
                type="button"
                onClick={() => void promptText("새 이름", e.name).then((input) => {
                  const name = input?.trim();
                  if (name && name !== e.name) attempt(() => savedQueryStore.rename(e.id, name));
                })}
                className="ml-auto hidden rounded px-1 hover:text-blue-700 group-hover:inline"
              >
                이름 변경
              </button>
              <button
                type="button"
                onClick={() => void confirmDialog(`"${e.name}"을(를) 삭제할까요?`).then((ok) => {
                  if (ok) attempt(() => savedQueryStore.remove(e.id));
                })}
                className="hidden rounded px-1 hover:text-red-600 group-hover:inline"
              >
                삭제
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
