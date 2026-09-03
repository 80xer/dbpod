import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useRef, useSyncExternalStore } from "react";
import { resultStore } from "../../entities/result/resultStore";
import type { DbValue } from "../../generated/ipc-types";

function cellText(v: DbValue): string {
  switch (v.t) {
    case "null":
      return "NULL";
    case "bool":
      return v.v ? "true" : "false";
    case "int":
    case "float":
      return String(v.v);
    default:
      return v.v;
  }
}

function cellClass(v: DbValue): string {
  if (v.t === "null") return "text-gray-400 italic";
  if (v.t === "fallback") return "text-gray-400";
  if (v.t === "int" || v.t === "float" || v.t === "numeric") return "text-right tabular-nums";
  return "";
}

// ponytail: header + virtualized rows straight from the ResultStore; adopt the
// TanStack Table column/row model when sorting/pinning lands in Milestone B.
export function ResultGrid({ resultTabId }: { resultTabId: string }) {
  const snapshot = useSyncExternalStore(
    useCallback((cb: () => void) => resultStore.subscribe(resultTabId, cb), [resultTabId]),
    () => resultStore.getSnapshot(resultTabId),
  );
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: snapshot.rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 10,
  });

  const statusLine = (() => {
    switch (snapshot.status) {
      case "idle":
        return "결과 없음 — 쿼리를 실행하세요 (Cmd+Enter)";
      case "running":
        return `실행 중… ${snapshot.rows.length}행 수신`;
      case "completed":
        return snapshot.commandTag
          ? `${snapshot.commandTag} 완료 · ${snapshot.affectedRows ?? 0}행 영향 · ${snapshot.durationMs}ms`
          : `${snapshot.rowCount}행${snapshot.truncated ? " (행 수 제한 도달)" : ""} · ${snapshot.durationMs}ms`;
      case "failed":
        return `오류: ${snapshot.error?.message ?? "unknown"}${snapshot.error?.sqlState ? ` (SQLSTATE ${snapshot.error.sqlState})` : ""}`;
      case "cancelled":
        return `취소됨 · ${snapshot.rowCount ?? 0}행 수신 · ${snapshot.durationMs}ms`;
    }
  })();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={parentRef}
        className="min-h-0 flex-1 overflow-auto border-t border-gray-200"
        role="grid"
        aria-rowcount={snapshot.rows.length}
      >
        {snapshot.columns.length > 0 && (
          <table className="border-separate border-spacing-0 text-[13px]">
            <thead className="sticky top-0 z-10">
              <tr role="row">
                <th className="border-b border-r border-gray-200 bg-gray-50 px-2 py-1 text-right font-normal text-gray-400">
                  #
                </th>
                {snapshot.columns.map((c) => (
                  <th
                    key={c.index}
                    className="max-w-[320px] truncate border-b border-r border-gray-200 bg-gray-50 px-2 py-1 text-left font-medium"
                    title={`${c.name} (${c.typeName.toLowerCase()})`}
                  >
                    {c.name}
                    <span className="ml-1 font-normal text-gray-400">{c.typeName.toLowerCase()}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody
              style={{ height: virtualizer.getTotalSize(), position: "relative", display: "block" }}
            >
              {virtualizer.getVirtualItems().map((vi) => {
                const row = snapshot.rows[vi.index];
                return (
                  <tr
                    key={vi.key}
                    role="row"
                    style={{
                      position: "absolute",
                      top: 0,
                      transform: `translateY(${vi.start}px)`,
                      display: "flex",
                      height: vi.size,
                    }}
                    className="hover:bg-blue-50"
                  >
                    <td className="w-14 shrink-0 border-b border-r border-gray-100 px-2 py-1 text-right text-gray-400">
                      {vi.index + 1}
                    </td>
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className={`w-[200px] shrink-0 truncate border-b border-r border-gray-100 px-2 py-1 ${cellClass(cell)}`}
                        title={cellText(cell)}
                      >
                        {cellText(cell)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="shrink-0 border-t border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-600">
        {statusLine}
        {snapshot.transactionState && snapshot.transactionState !== "idle" && (
          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">
            {snapshot.transactionState === "in-transaction" ? "트랜잭션 열림" : "트랜잭션 실패 상태"}
          </span>
        )}
      </div>
    </div>
  );
}
