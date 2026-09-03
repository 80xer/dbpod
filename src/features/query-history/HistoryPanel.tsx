import { useState } from "react";
import { historyStore, useHistory } from "../../entities/query/historyStore";

type Props = {
  connectionId: string;
  onReopen: (sql: string) => void;
  onClose: () => void;
};

export function HistoryPanel({ connectionId, onReopen, onClose }: Props) {
  const all = useHistory();
  const [filter, setFilter] = useState("");
  const entries = all.filter(
    (e) =>
      e.connectionId === connectionId &&
      (!filter || e.sql.toLowerCase().includes(filter.toLowerCase())),
  );

  return (
    <div className="flex w-72 shrink-0 flex-col border-l border-gray-200 bg-gray-50">
      <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 px-2 py-1.5">
        <span className="text-xs font-semibold">쿼리 이력 (세션 메모리)</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="이력 닫기"
          className="ml-auto rounded px-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
        >
          ×
        </button>
      </div>
      <div className="shrink-0 p-2">
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="SQL 검색"
          aria-label="이력 검색"
          className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
        />
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-2">
        {entries.length === 0 && <li className="py-2 text-xs text-gray-400">이력이 없습니다</li>}
        {entries.map((e) => (
          <li key={e.id} className="group mb-1 rounded border border-gray-200 bg-white p-1.5">
            <button
              type="button"
              onClick={() => onReopen(e.sql)}
              title="새 쿼리 탭에서 열기"
              className="block w-full truncate text-left font-mono text-[11px] text-gray-800 hover:text-blue-700"
            >
              {e.sql}
            </button>
            <div className="mt-0.5 flex items-center text-[10px] text-gray-400">
              <span>
                {new Date(e.startedAt).toLocaleTimeString()} ·{" "}
                {e.status === "completed" ? `${e.durationMs ?? 0}ms` : e.status}
              </span>
              <button
                type="button"
                onClick={() => historyStore.remove(e.id)}
                className="ml-auto hidden rounded px-1 text-gray-400 hover:text-red-600 group-hover:inline"
              >
                삭제
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="shrink-0 border-t border-gray-200 px-2 py-1.5">
        <button
          type="button"
          onClick={() => {
            if (window.confirm("이 연결의 쿼리 이력을 모두 삭제할까요?"))
              historyStore.clear(connectionId);
          }}
          className="text-xs text-gray-500 hover:text-red-600"
        >
          전체 삭제
        </button>
      </div>
    </div>
  );
}
