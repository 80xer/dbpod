import type { ColumnMeta, TableMetadata } from "../../generated/ipc-types";
import { ipc } from "../../shared/ipc/invoke";
import { stripLiterals } from "../query-editor/statementSplitter";

export type EditableInfo = {
  editable: true;
  relationOid: number;
  meta: TableMetadata;
  /** index of the hidden xmin column, if the result carries one */
  xminColumnIndex?: number;
  /** primary key: catalog name + attnum + index of the displaying column */
  pk: Array<{ attributeNumber: number; columnName: string; columnIndex: number }>;
  /** display column names that accept edits */
  editableColumns: Set<string>;
  /** display column name -> catalog column name */
  catalogName: Record<string, string>;
  lockMode: "xmin" | "displayed";
};

export type Editability = { editable: false; reason: string } | EditableInfo;

const BLOCKED =
  /\b(JOIN|GROUP\s+BY|HAVING|DISTINCT|UNION|INTERSECT|EXCEPT|OVER|INTO|RETURNING)\b|^\s*WITH\b|\(\s*SELECT\b/i;

function analyzeColumns(
  columns: ColumnMeta[],
  meta: TableMetadata,
  relationOid: number,
): Editability {
  const xminColumnIndex = columns.find((c) => c.name === "__dbpod_xmin")?.index;
  const visible = columns.filter((c) => c.name !== "__dbpod_xmin");

  // duplicate source column => ambiguous mapping
  const seen = new Set<number>();
  for (const c of visible) {
    if (!c.source) continue;
    if (seen.has(c.source.attributeNumber))
      return { editable: false, reason: "동일한 원본 컬럼이 중복 표시되어 편집할 수 없습니다" };
    seen.add(c.source.attributeNumber);
  }

  const catalogByAttnum = new Map(meta.columns.map((c) => [c.attributeNumber, c]));
  const displayByAttnum = new Map(
    visible.filter((c) => c.source).map((c) => [c.source!.attributeNumber, c]),
  );

  const pk: EditableInfo["pk"] = [];
  for (const attnum of meta.primaryKey) {
    const display = displayByAttnum.get(attnum);
    const catalog = catalogByAttnum.get(attnum);
    if (!display || !catalog)
      return { editable: false, reason: "Primary Key 컬럼이 결과에 모두 포함되어야 편집할 수 있습니다" };
    pk.push({
      attributeNumber: attnum,
      columnName: catalog.name,
      columnIndex: display.index,
    });
  }
  if (pk.length === 0) return { editable: false, reason: "Primary Key가 없는 테이블은 편집할 수 없습니다" };

  const editableColumns = new Set<string>();
  const catalogName: Record<string, string> = {};
  for (const c of visible) {
    if (!c.source || c.source.relationOid !== relationOid) continue;
    const catalog = catalogByAttnum.get(c.source.attributeNumber);
    if (!catalog) continue;
    catalogName[c.name] = catalog.name;
    if (!catalog.isGenerated && c.category !== "array") editableColumns.add(c.name);
  }

  return {
    editable: true,
    relationOid,
    meta,
    xminColumnIndex,
    pk,
    editableColumns,
    catalogName,
    lockMode: xminColumnIndex !== undefined ? "xmin" : "displayed",
  };
}

/** Table Data tab: metadata already known, xmin column always selected. */
export function tableDataEditability(
  columns: ColumnMeta[],
  meta: TableMetadata,
  readOnly: boolean,
): Editability {
  if (readOnly) return { editable: false, reason: "읽기 전용 연결입니다" };
  if (meta.kind !== "table" && meta.kind !== "partitioned-table")
    return { editable: false, reason: "베이스 테이블만 편집할 수 있습니다" };
  return analyzeColumns(columns, meta, meta.relationOid);
}

/**
 * Query Result: conservative gate — single-table plain SELECT proved by
 * column origin metadata + a literal-stripped keyword scan. Anything
 * uncertain stays read-only (spec: cannot prove editable => read-only).
 */
export async function queryEditability(
  connectionId: string,
  executedSql: string | undefined,
  columns: ColumnMeta[],
  readOnly: boolean,
): Promise<Editability> {
  if (readOnly) return { editable: false, reason: "읽기 전용 연결입니다" };
  if (!executedSql) return { editable: false, reason: "실행 SQL을 확인할 수 없습니다" };
  const stripped = stripLiterals(executedSql);
  if (!/^\s*SELECT\b/i.test(stripped))
    return { editable: false, reason: "단일 SELECT 결과만 편집할 수 있습니다" };
  if (BLOCKED.test(stripped))
    return { editable: false, reason: "JOIN·집계·서브쿼리 결과는 읽기 전용입니다" };

  const sources = columns.filter((c) => c.name !== "__dbpod_xmin").map((c) => c.source);
  const relationOids = new Set(sources.filter(Boolean).map((s) => s!.relationOid));
  if (relationOids.size !== 1)
    return { editable: false, reason: "단일 베이스 테이블 결과만 편집할 수 있습니다" };
  const relationOid = [...relationOids][0];

  let meta: TableMetadata;
  try {
    meta = await ipc.metadataGetTable({ connectionId, relationOid });
  } catch {
    return { editable: false, reason: "원본 테이블 메타데이터를 확인할 수 없습니다" };
  }
  if (meta.kind !== "table" && meta.kind !== "partitioned-table")
    return { editable: false, reason: "뷰 결과는 읽기 전용입니다" };
  return analyzeColumns(columns, meta, relationOid);
}
