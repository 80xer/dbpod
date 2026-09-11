import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
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
  database: string;
  changingDatabase: boolean;
  readOnly: boolean;
  onChangeDatabase: (database: string) => void;
  onOpenObject: (obj: DatabaseObjectSummary) => void;
  className?: string;
};

type ObjectNode = { object: DatabaseObjectSummary; children: ObjectNode[] };
const expansionState = new Map<string, boolean>();
const useExpansion = (key: string, initial: boolean) => {
  const [open, setOpen] = useState(() => expansionState.get(key) ?? initial);
  const update = (next: boolean) => { expansionState.set(key, next); setOpen(next); };
  return [open, update] as const;
};

function ObjectBranch({ node, schema, filter, onOpenObject, onObjectContextMenu }: {
  node: ObjectNode;
  schema: string;
  filter: string;
  onOpenObject: Props["onOpenObject"];
  onObjectContextMenu: (object: DatabaseObjectSummary, x: number, y: number) => void;
}) {
  const [branchOpen, setBranchOpen] = useExpansion(`branch:${node.object.oid}`, !!filter);
  const expanded = branchOpen || !!filter;
  const o = node.object;
  const label = o.schema === schema ? o.name : `${o.schema}.${o.name}`;
  if (o.kind === "function") {
    const signature = `${label}(${o.functionArguments ?? ""})`;
    return <li>
      <button type="button" onClick={() => onOpenObject(o)} title={`${o.schema}.${signature} 정의 보기`}
        onContextMenu={(event) => { event.preventDefault(); onObjectContextMenu(o, event.clientX, event.clientY); }}
        className="flex w-full items-center gap-1.5 py-0.5 pl-5 pr-2 text-left text-xs hover:bg-blue-50">
        <span aria-hidden="true" className="text-gray-400">ƒ</span>
        <span className="truncate">{signature}</span>
      </button>
    </li>;
  }
  return (
    <li>
      <div className="flex items-center" onContextMenu={(event) => {
        event.preventDefault();
        onObjectContextMenu(o, event.clientX, event.clientY);
      }}>
        {node.children.length > 0 ? (
          <button
            type="button"
            aria-label={`${label} 파티션`}
            aria-expanded={expanded}
            onClick={() => setBranchOpen(!expanded)}
            className="w-5 shrink-0 py-0.5 text-xs text-gray-400 hover:bg-blue-50"
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : <span className="w-5 shrink-0" />}
        <button
          type="button"
          onDoubleClick={() => onOpenObject(o)}
          disabled={o.canSelect === false}
          title={o.canSelect === false ? `${label} — SELECT 권한 없음` : `${o.schema}.${o.name} 더블클릭으로 열기`}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5 pr-2 text-left text-xs hover:bg-blue-50 disabled:cursor-not-allowed disabled:text-gray-300"
        >
          <span aria-hidden="true" className="text-gray-400">{KIND_ICON[o.kind] ?? "▪"}</span>
          <span className="truncate">{label}</span>
        </button>
      </div>
      {expanded && node.children.length > 0 && (
        <ul className="ml-3 border-l border-gray-200">
          {node.children.map((child) => (
            <ObjectBranch key={child.object.oid} node={child} schema={schema} filter={filter} onOpenObject={onOpenObject} onObjectContextMenu={onObjectContextMenu} />
          ))}
        </ul>
      )}
    </li>
  );
}

function ObjectGroup({
  connectionId,
  schemaOid,
  name,
  filter,
  onOpenObject,
  onObjectContextMenu,
  kind,
}: {
  connectionId: string;
  schemaOid: number;
  name: string;
  filter: string;
  onOpenObject: Props["onOpenObject"];
  onObjectContextMenu: (object: DatabaseObjectSummary, x: number, y: number) => void;
  kind: "table" | "function";
}) {
  const [groupOpen, setGroupOpen] = useExpansion(`group:${connectionId}:${schemaOid}:${kind}`, !!filter);
  const open = groupOpen || !!filter;
  const label = kind === "table" ? "Tables" : "Functions";
  const objects = useQuery({
    queryKey: ["objects", connectionId, schemaOid, kind],
    queryFn: () =>
      ipc.metadataListObjects({
        connectionId,
        schemaOids: [schemaOid],
        kinds: kind === "table" ? ["table", "view", "materialized-view"] : ["function"],
      }),
    enabled: open,
    staleTime: 60_000,
  });

  const visible = useMemo(() => {
    const nodes = new Map<number, ObjectNode>(
      objects.data?.map((object) => [object.oid, { object, children: [] }]),
    );
    const roots: ObjectNode[] = [];
    for (const node of nodes.values()) {
      const parent = node.object.partitionParentOid == null ? undefined : nodes.get(node.object.partitionParentOid);
      (parent?.children ?? roots).push(node);
    }
    const needle = filter.toLowerCase();
    if (!needle) return roots;
    const matches = (branch: ObjectNode[]): ObjectNode[] => branch.flatMap((node) => {
      const children = matches(node.children);
      return children.length || `${node.object.name}(${node.object.functionArguments ?? ""})`.toLowerCase().includes(needle)
        ? [{ ...node, children }]
        : [];
    });
    return matches(roots);
  }, [objects.data, filter]);

  return (
    <li>
      <button
        type="button"
        onClick={() => setGroupOpen(!open)}
        className="flex w-full items-center gap-1 px-2 py-1 text-left text-xs font-medium text-gray-700 hover:bg-gray-100"
        aria-expanded={open}
        aria-label={`${name} ${label}`}
      >
        <span className="text-gray-400">{open ? "▾" : "▸"}</span>
        {label}
      </button>
      {open && (
        <ul className="ml-2" aria-label={`${name} ${label} 목록`}>
          {objects.isLoading && <li className="px-3 py-1 text-xs text-gray-400">불러오는 중…</li>}
          {objects.isError && (
            <li className="px-3 py-1 text-xs text-red-500">목록을 불러오지 못했습니다 <button type="button" className="underline" onClick={() => void objects.refetch()}>다시 시도</button></li>
          )}
          {objects.data && visible.length === 0 && (
            <li className="px-3 py-1 text-xs text-gray-400">
              {filter ? "일치 항목 없음" : "객체 없음"}
            </li>
          )}
          {visible.map((node) => (
            <ObjectBranch key={node.object.oid} node={node} schema={name} filter={filter} onOpenObject={onOpenObject} onObjectContextMenu={onObjectContextMenu} />
          ))}
        </ul>
      )}
    </li>
  );
}

function SchemaSection(props: {
  connectionId: string; schemaOid: number; name: string; filter: string; onOpenObject: Props["onOpenObject"];
  onObjectContextMenu: (object: DatabaseObjectSummary, x: number, y: number) => void;
}) {
  const [open, setOpen] = useExpansion(`schema:${props.connectionId}:${props.schemaOid}`, props.name === "public");
  return <div>
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-1 px-2 py-1 text-left text-xs font-medium text-gray-700 hover:bg-gray-100">
      <span aria-hidden="true" className="text-gray-400">{open ? "▾" : "▸"}</span>{props.name}
    </button>
    {open && <ul className="ml-2">
      <ObjectGroup {...props} kind="table" />
      <ObjectGroup {...props} kind="function" />
    </ul>}
  </div>;
}

export function ObjectSidebar({ connectionId, database, changingDatabase, readOnly, onChangeDatabase, onOpenObject, className }: Props) {
  const [filter, setFilter] = useState("");
  const [includeSystem, setIncludeSystem] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ object: DatabaseObjectSummary; x: number; y: number } | null>(null);
  const [deletingOid, setDeletingOid] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("click", close);
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("click", close); window.removeEventListener("keydown", escape); };
  }, [contextMenu]);
  const showContextMenu = (object: DatabaseObjectSummary, x: number, y: number) => {
    setDeleteError("");
    setContextMenu({ object, x: Math.min(x, window.innerWidth - 140), y: Math.min(y, window.innerHeight - 44) });
  };
  const dropObject = async () => {
    const object = contextMenu?.object;
    if (!object || readOnly || deletingOid !== null) return;
    const signature = object.kind === "function" ? `(${object.functionArguments ?? ""})` : "";
    const label = `${object.schema}.${object.name}${signature}`;
    if (!window.confirm(`${label}을(를) 삭제할까요?\n\n이 작업은 되돌릴 수 없습니다. 종속 객체가 있으면 삭제되지 않습니다.`)) return;
    setContextMenu(null);
    setDeletingOid(object.oid);
    try {
      await ipc.metadataDropObject({ connectionId, objectOid: object.oid, kind: object.kind });
      await queryClient.invalidateQueries({ queryKey: ["objects", connectionId] });
    } catch (error) {
      setDeleteError((error as { message?: string }).message ?? String(error));
    } finally {
      setDeletingOid(null);
    }
  };
  const databases = useQuery({
    queryKey: ["databases", connectionId],
    queryFn: () => ipc.metadataListDatabases(connectionId),
    staleTime: 60_000,
  });
  const schemas = useQuery({
    queryKey: ["schemas", connectionId, includeSystem],
    queryFn: () => ipc.metadataListSchemas({ connectionId, includeSystem }),
    staleTime: 60_000,
  });

  return (
    <div className={`flex h-full shrink-0 flex-col border-r border-gray-200 bg-gray-50 ${className ?? "w-56"}`}>
      <div className="shrink-0 p-2">
        <label htmlFor="explorer-database" className="mb-1 block text-xs font-medium text-gray-600">데이터베이스</label>
        <select id="explorer-database" value={database} disabled={changingDatabase || databases.isPending}
          onChange={(e) => onChangeDatabase(e.target.value)} className="mb-2 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs disabled:opacity-50">
          {!databases.data?.some((d) => d.name === database) && <option value={database}>{database}</option>}
          {databases.data?.map((d) => <option key={d.name} value={d.name} disabled={!d.canConnect}>{d.name}{!d.canConnect ? " · 접속 불가" : ""}</option>)}
        </select>
        {changingDatabase && <p role="status" className="mb-2 text-xs text-gray-500">DB 연결 중…</p>}
        {databases.isError && <p role="alert" className="mb-2 text-xs text-red-600">DB 목록을 불러오지 못했습니다 <button type="button" className="underline" onClick={() => void databases.refetch()}>다시 시도</button></p>}
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="객체 검색"
          aria-label="객체 검색"
          className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
        />
        {deleteError && <p role="alert" className="mt-2 text-xs text-red-600">삭제하지 못했습니다: {deleteError}</p>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {schemas.isLoading && <p className="px-3 text-xs text-gray-400">스키마 불러오는 중…</p>}
        {schemas.isError && (
          <p className="px-3 text-xs text-red-500">스키마를 불러오지 못했습니다</p>
        )}
        {schemas.data?.map((s) => (
          <SchemaSection
            key={`${connectionId}:${s.oid}`}
            connectionId={connectionId}
            schemaOid={s.oid}
            name={s.name}
            filter={filter}
            onOpenObject={onOpenObject}
            onObjectContextMenu={showContextMenu}
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
      {contextMenu && (
        <div role="menu" aria-label={`${contextMenu.object.name} 메뉴`}
          className="fixed z-50 min-w-32 rounded border border-gray-200 bg-white p-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }} onContextMenu={(event) => event.preventDefault()}>
          <button type="button" role="menuitem" disabled={readOnly || deletingOid !== null}
            onClick={() => void dropObject()}
            className="w-full rounded px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 disabled:text-gray-300">
            {readOnly ? "삭제 (읽기 전용)" : "삭제"}
          </button>
        </div>
      )}
    </div>
  );
}
