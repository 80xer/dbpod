import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { DatabaseObjectSummary } from "../../generated/ipc-types";
import { ipc } from "../../shared/ipc/invoke";

const KIND_ICON: Record<string, string> = {
  table: "▦",
  view: "▤",
  "materialized-view": "▥",
  sequence: "↻",
  function: "ƒ",
};

type Props = {
  connectionId: string;
  onOpenTable: (obj: DatabaseObjectSummary) => void;
};

function SchemaSection({
  connectionId,
  schemaOid,
  name,
  filter,
  onOpenTable,
}: {
  connectionId: string;
  schemaOid: number;
  name: string;
  filter: string;
  onOpenTable: Props["onOpenTable"];
}) {
  const [open, setOpen] = useState(name === "public");
  const objects = useQuery({
    queryKey: ["objects", connectionId, schemaOid],
    queryFn: () =>
      ipc.metadataListObjects({
        connectionId,
        schemaOids: [schemaOid],
        kinds: ["table", "view", "materialized-view"],
      }),
    enabled: open,
    staleTime: 60_000,
  });

  const visible = objects.data?.filter(
    (o) => !filter || o.name.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1 px-2 py-1 text-left text-xs font-medium text-gray-700 hover:bg-gray-100"
        aria-expanded={open}
      >
        <span className="text-gray-400">{open ? "▾" : "▸"}</span>
        {name}
      </button>
      {open && (
        <ul className="ml-2">
          {objects.isLoading && <li className="px-3 py-1 text-xs text-gray-400">불러오는 중…</li>}
          {objects.isError && (
            <li className="px-3 py-1 text-xs text-red-500">목록을 불러오지 못했습니다</li>
          )}
          {visible?.length === 0 && (
            <li className="px-3 py-1 text-xs text-gray-400">
              {filter ? "일치 항목 없음" : "객체 없음"}
            </li>
          )}
          {visible?.map((o) => (
            <li key={`${o.kind}-${o.oid}`}>
              <button
                type="button"
                onClick={() => onOpenTable(o)}
                disabled={o.canSelect === false}
                title={
                  o.canSelect === false
                    ? `${o.name} — SELECT 권한 없음`
                    : `${o.schema}.${o.name} 데이터 열기`
                }
                className="flex w-full items-center gap-1.5 truncate px-3 py-0.5 text-left text-xs hover:bg-blue-50 disabled:cursor-not-allowed disabled:text-gray-300"
              >
                <span className="text-gray-400">{KIND_ICON[o.kind] ?? "▪"}</span>
                <span className="truncate">{o.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ObjectSidebar({ connectionId, onOpenTable }: Props) {
  const [filter, setFilter] = useState("");
  const [includeSystem, setIncludeSystem] = useState(false);
  const schemas = useQuery({
    queryKey: ["schemas", connectionId, includeSystem],
    queryFn: () => ipc.metadataListSchemas({ connectionId, includeSystem }),
    staleTime: 60_000,
  });

  return (
    <div className="flex h-full w-56 shrink-0 flex-col border-r border-gray-200 bg-gray-50">
      <div className="shrink-0 p-2">
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="객체 검색"
          aria-label="객체 검색"
          className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {schemas.isLoading && <p className="px-3 text-xs text-gray-400">스키마 불러오는 중…</p>}
        {schemas.isError && (
          <p className="px-3 text-xs text-red-500">스키마를 불러오지 못했습니다</p>
        )}
        {schemas.data?.map((s) => (
          <SchemaSection
            key={s.oid}
            connectionId={connectionId}
            schemaOid={s.oid}
            name={s.name}
            filter={filter}
            onOpenTable={onOpenTable}
          />
        ))}
      </div>
      <label className="flex shrink-0 items-center gap-1.5 border-t border-gray-200 px-2 py-1.5 text-xs text-gray-500">
        <input
          type="checkbox"
          checked={includeSystem}
          onChange={(e) => setIncludeSystem(e.target.checked)}
        />
        시스템 스키마 표시
      </label>
    </div>
  );
}
