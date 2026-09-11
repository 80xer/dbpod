import type { ColumnMeta, TableMetadata } from "../../generated/ipc-types";
import { ipc } from "../../shared/ipc/invoke";
import { splitStatements, stripLiterals } from "../query-editor/statementSplitter";

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
  /\b(JOIN|GROUP\s+BY|HAVING|DISTINCT|UNION|INTERSECT|EXCEPT|OVER|INTO|RETURNING)\b|^\s*WITH\b|\(\s*(SELECT|TABLE|WITH|VALUES)\b/i;
const UNSUPPORTED = new Set(["array", "binary", "range", "composite", "unknown"]);
const unsafeName = (name: string) =>
  !name || name === "prototype" || Object.prototype.hasOwnProperty.call(Object.prototype, name);

/** A deliberately narrow SELECT/FROM grammar; origin metadata proves the columns. */
function isPlainSelect(sql: string): boolean {
  const statements = splitStatements(stripLiterals(sql));
  if (statements.length !== 1) return false;
  // Quoted identifiers can contain keywords and commas; treat each as one token.
  const lexical = statements[0].sql.replace(/"(?:""|[^"])*"/g, "dbpod_identifier");
  if (BLOCKED.test(lexical)) return false;
  const select = /^\s*SELECT\s+([\s\S]+?)\s+FROM\s+([\s\S]+)$/i.exec(lexical);
  if (!select) return false;
  const ident = "[A-Za-z_][A-Za-z0-9_$]*";
  const alias = `(?:\\s+(?:AS\\s+)?${ident})?`;
  const projection = new RegExp(`^(?:${ident}\\s*\\.\\s*){0,2}(?:${ident}|\\*)${alias}$`, "i");
  if (!select[1].split(",").every((column) => projection.test(column.trim()))) return false;
  const from = select[2].split(/\b(?:WHERE|ORDER\s+BY|LIMIT|OFFSET|FETCH|FOR)\b/i)[0].trim();
  return new RegExp(`^(?:ONLY\\s+)?${ident}(?:\\s*\\.\\s*${ident})?${alias}$`, "i").test(from);
}

function analyzeColumns(
  columns: ColumnMeta[],
  meta: TableMetadata,
  relationOid: number,
  xminColumnIndex?: number,
): Editability {
  if (meta.relationOid !== relationOid || columns.some((c, i) => c.index !== i))
    return { editable: false, reason: "결과와 원본 테이블의 컬럼 정보를 확인할 수 없습니다" };
  if (meta.columns.some((c) => c.name === "__dbpod_xmin" || unsafeName(c.name)))
    return { editable: false, reason: "안전한 변경 저장에 사용할 수 없는 원본 컬럼 이름입니다" };
  const visible = columns.filter((c) => c.index !== xminColumnIndex);

  // Drafts are keyed by display name; identities and values require unique origins.
  const seen = new Set<number>();
  const names = new Set<string>();
  for (const c of visible) {
    if (unsafeName(c.name) || c.name === "__dbpod_xmin" || names.has(c.name))
      return { editable: false, reason: "중복되거나 안전하지 않은 결과 컬럼 이름은 편집할 수 없습니다" };
    names.add(c.name);
    if (!c.source || c.source.relationOid !== relationOid)
      return { editable: false, reason: "계산식 또는 원본을 확인할 수 없는 컬럼이 포함되어 있습니다" };
    if (seen.has(c.source.attributeNumber))
      return { editable: false, reason: "동일한 원본 컬럼이 중복 표시되어 편집할 수 없습니다" };
    seen.add(c.source.attributeNumber);
    // Displayed-value locking needs values that the decoder and equality operator support.
    if (xminColumnIndex === undefined && (UNSUPPORTED.has(c.category) || c.pgTypeOid === 114 || c.pgTypeOid === 142))
      return { editable: false, reason: "표시된 값으로 안전한 충돌 검사를 지원하지 않는 타입이 포함되어 있습니다" };
  }

  const catalogByAttnum = new Map(meta.columns.map((c) => [c.attributeNumber, c]));
  if (visible.some((c) => catalogByAttnum.get(c.source!.attributeNumber)?.pgTypeOid !== c.pgTypeOid))
    return { editable: false, reason: "결과 컬럼의 원본 타입을 확인할 수 없습니다" };
  const displayByAttnum = new Map(
    visible.filter((c) => c.source).map((c) => [c.source!.attributeNumber, c]),
  );

  const pk: EditableInfo["pk"] = [];
  for (const attnum of meta.primaryKey) {
    const display = displayByAttnum.get(attnum);
    const catalog = catalogByAttnum.get(attnum);
    if (!display || !catalog || UNSUPPORTED.has(display.category))
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
    if (!catalog.isGenerated && !UNSUPPORTED.has(c.category)) editableColumns.add(c.name);
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
  const xmin = columns.filter((c) => c.name === "__dbpod_xmin");
  if (xmin.length !== 1 || xmin[0].index !== 0 || xmin[0].source !== null || xmin[0].pgTypeOid !== 25 || xmin[0].category !== "text")
    return { editable: false, reason: "행 버전 정보를 확인할 수 없습니다" };
  return analyzeColumns(columns, meta, meta.relationOid, xmin[0].index);
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
  if (!isPlainSelect(executedSql))
    return { editable: false, reason: "단일 테이블의 일반 SELECT 결과만 편집할 수 있습니다" };

  const sources = columns.map((c) => c.source);
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
