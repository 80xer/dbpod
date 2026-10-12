import { useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import type { TableIndex, TableIndexColumn, TableMetadata } from "../../generated/ipc-types";
import type { TableDataTarget } from "../../entities/workspace/workspaceStore";
import { ipc } from "../../shared/ipc/invoke";
import { DefinitionView } from "./DefinitionView";

export type PropertySection = "columns" | "indexes" | "ddl";

const TH = "border-b border-gray-200 px-2 py-1 text-left font-medium text-gray-600";
const TD = "border-b border-gray-100 px-2 py-1";

type Props = {
  connectionId: string;
  target: TableDataTarget;
  meta: TableMetadata | undefined;
  section: PropertySection;
  onSectionChange: (section: PropertySection) => void;
};

/** Sections a relation has: plain views have no indexes; DDL waits for the kind, which picks the script source. */
function sectionsFor(kind: string | undefined): [PropertySection, string][] {
  const sections: [PropertySection, string][] = [["columns", "Columns"]];
  if (kind && kind !== "view") sections.push(["indexes", "Indexes"]);
  if (kind) sections.push(["ddl", "DDL"]);
  return sections;
}

export function TablePropertiesView({ connectionId, target, meta, section, onSectionChange }: Props) {
  const sections = sectionsFor(meta?.kind);
  const shown = sections.some(([s]) => s === section) ? section : "columns";
  return (
    <div className="min-h-0 flex-1">
      <div className="flex h-full min-h-0">
        <nav aria-label="속성 항목" className="flex w-32 shrink-0 flex-col gap-0.5 border-r border-gray-200 bg-gray-50 p-2 text-xs">
          {sections.map(([s, label]) => (
            <button key={s} type="button" aria-current={shown === s ? "page" : undefined} onClick={() => onSectionChange(s)}
              className={`w-full rounded px-2 py-1 text-left ${shown === s ? "bg-white font-medium text-gray-900" : "text-gray-600 hover:bg-gray-100"}`}>
              {label}
            </button>
          ))}
        </nav>
        {shown === "ddl" ? (
          meta?.kind === "view" || meta?.kind === "materialized-view" ? (
            <DefinitionView title={`${target.schema}.${target.name}`} queryKey={["view-definition", connectionId, target.relationOid]}
              load={() => ipc.metadataGetViewDefinition({ connectionId, relationOid: target.relationOid })} />
          ) : (
            <DefinitionView title={`${target.schema}.${target.name}`} queryKey={["table-ddl", connectionId, target.relationOid]}
              load={() => ipc.metadataGetTableDdl({ connectionId, relationOid: target.relationOid })} />
          )
        ) : (
          <section className="min-h-0 flex-1 overflow-auto">
            {shown === "indexes" ? <IndexesTable connectionId={connectionId} relationOid={target.relationOid} /> : <ColumnsTable meta={meta} />}
          </section>
        )}
      </div>
    </div>
  );
}

function ColumnsTable({ meta }: { meta: TableMetadata | undefined }) {
  return (
    <table className="min-w-full table-auto border-separate border-spacing-0 text-xs">
      <thead className="sticky top-0 bg-gray-50">
        <tr>
          <th className={TH}>#</th>
          <th className={TH}>column name</th>
          <th className={TH}>data type</th>
          <th className={TH}>not null</th>
          <th className={TH}>default</th>
          <th className={TH}>comment</th>
        </tr>
      </thead>
      <tbody>
        {meta?.columns.map((column) => (
          <tr key={column.attributeNumber}>
            <td className={TD}>{column.attributeNumber}</td>
            <td className={TD}>{column.name}</td>
            <td className={TD}>{column.pgTypeName}</td>
            <td className={TD}>{column.nullable ? "YES" : "NO"}</td>
            <td className={TD}>{column.defaultExpr ?? "-"}</td>
            <td className={TD}>{column.comment ?? "-"}</td>
          </tr>
        ))}
        {!meta && (
          <tr><td className="px-2 py-1 text-gray-500" colSpan={6}>컬럼 정보를 불러오는 중…</td></tr>
        )}
        {meta?.columns.length === 0 && (
          <tr><td className="px-2 py-1 text-gray-500" colSpan={6}>컬럼 정보가 없습니다.</td></tr>
        )}
      </tbody>
    </table>
  );
}

const yesNo = (value: boolean | null) => (value === null ? "-" : value ? "YES" : "NO");

/** "ASC"/"DESC", naming NULLS only where it differs from the direction's default; "-" when unordered. */
function orderLabel(column: TableIndexColumn): string {
  if (column.descending === null) return "-";
  const direction = column.descending ? "DESC" : "ASC";
  return column.nullsFirst === column.descending ? direction : `${direction} NULLS ${column.nullsFirst ? "FIRST" : "LAST"}`;
}

function summary(index: TableIndex) {
  const keys = index.columns.filter((c) => c.isKey);
  const included = index.columns.filter((c) => !c.isKey);
  const orders = keys.map(orderLabel);
  const nullables = keys.map((c) => c.nullable);
  return {
    columns: keys.map((c) => c.name).join(", ") + (included.length ? ` INCLUDE (${included.map((c) => c.name).join(", ")})` : ""),
    order: orders.every((o) => o === orders[0]) ? (orders[0] ?? "-") : orders.join(", "),
    // A NULL in any key column exempts the row from uniqueness; expressions are unknown.
    nullable: nullables.includes(true) ? "YES" : nullables.includes(null) ? "-" : "NO",
  };
}

function IndexesTable({ connectionId, relationOid }: { connectionId: string; relationOid: number }) {
  const indexes = useQuery({
    queryKey: ["table-indexes", connectionId, relationOid],
    queryFn: () => ipc.metadataListIndexes({ connectionId, relationOid }),
    staleTime: 60_000,
  });
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggle = (name: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (!next.delete(name)) next.add(name);
    return next;
  });
  const COLS = 9;
  return (
    <table aria-label="인덱스" className="min-w-full table-auto border-separate border-spacing-0 text-xs">
      <thead className="sticky top-0 bg-gray-50">
        <tr>
          <th className={`${TH} w-6`}><span className="sr-only">펼치기</span></th>
          <th className={TH}>columns</th>
          <th className={TH}>index name</th>
          <th className={TH}>primary</th>
          <th className={TH}>unique</th>
          <th className={TH}>nullable</th>
          <th className={TH}>order</th>
          <th className={TH}>method</th>
          <th className={TH}>condition</th>
        </tr>
      </thead>
      <tbody>
        {indexes.data?.map((index) => {
          const open = expanded.has(index.name);
          const s = summary(index);
          return (
            <Fragment key={index.name}>
              <tr>
                <td className={`${TD} w-6 text-center`}>
                  <button type="button" aria-expanded={open} aria-label={`${index.name} 컬럼`} onClick={() => toggle(index.name)}
                    className="rounded px-1 text-gray-500 hover:bg-gray-100">
                    <span aria-hidden="true">{open ? "▾" : "▸"}</span>
                  </button>
                </td>
                <td className={TD}>{s.columns}</td>
                <td className={TD}>
                  {index.name}
                  {!index.isValid && <span className="ml-1 rounded bg-amber-100 px-1 text-amber-800">INVALID</span>}
                </td>
                <td className={TD}>{yesNo(index.isPrimary)}</td>
                <td className={TD}>{yesNo(index.isUnique)}</td>
                <td className={TD}>{s.nullable}</td>
                <td className={TD}>{s.order}</td>
                <td className={TD}>{index.method}</td>
                <td className={TD}>{index.predicate ?? "-"}</td>
              </tr>
              {open && index.columns.map((column, i) => (
                <tr key={i} aria-label={`${index.name} 컬럼 ${i + 1}`} className="bg-gray-50 text-gray-700">
                  <td className={TD} />
                  <td className={`${TD} pl-6`}>
                    {column.name}
                    {!column.isKey && <span className="ml-1 text-gray-500">INCLUDE</span>}
                  </td>
                  <td className={TD} />
                  <td className={TD} />
                  <td className={TD} />
                  <td className={TD}>{yesNo(column.nullable)}</td>
                  <td className={TD}>{orderLabel(column)}</td>
                  <td className={TD} />
                  <td className={TD} />
                </tr>
              ))}
            </Fragment>
          );
        })}
        {indexes.isPending && (
          <tr><td className="px-2 py-1 text-gray-500" colSpan={COLS}>인덱스 정보를 불러오는 중…</td></tr>
        )}
        {indexes.isError && (
          <tr><td role="alert" className="px-2 py-1 text-red-600" colSpan={COLS}>
            인덱스 정보를 불러오지 못했습니다: {indexes.error.message}{" "}
            <button type="button" className="underline" onClick={() => void indexes.refetch()}>다시 시도</button>
          </td></tr>
        )}
        {indexes.data?.length === 0 && (
          <tr><td className="px-2 py-1 text-gray-500" colSpan={COLS}>인덱스가 없습니다.</td></tr>
        )}
      </tbody>
    </table>
  );
}
