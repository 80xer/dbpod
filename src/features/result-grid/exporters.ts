import type { ColumnMeta, DbValue } from "../../generated/ipc-types";

type ArrayValue = Extract<DbValue, { kind: "array" }>;
type ArrayTree = DbValue | ArrayTree[];

/** Dimensions describe a row-major flat payload, not nested DbValues. */
function arrayTree(v: ArrayValue): ArrayTree[] {
  const count = v.dimensions.reduce((total, d) => total * d.length, v.dimensions.length ? 1 : 0);
  if (
    !Number.isSafeInteger(count) || count !== v.values.length || v.dimensions.length > 6 ||
    v.dimensions.some((d) => !Number.isInteger(d.lowerBound) || !Number.isInteger(d.length) || d.length < 0) ||
    (v.dimensions.length > 1 && v.dimensions.some((d) => d.length === 0)) ||
    v.values.some((cell) => cell.kind === "array")
  ) throw new Error("배열 차원과 값이 일치하지 않습니다. 배열을 ::text로 조회한 후 내보내세요.");
  if (count === 0) return [];
  let index = 0;
  const nest = (depth: number): ArrayTree[] => Array.from(
    { length: v.dimensions[depth].length },
    () => depth === v.dimensions.length - 1 ? v.values[index++] : nest(depth + 1),
  );
  return nest(0);
}

function arrayText(v: ArrayValue): string {
  const render = (items: ArrayTree[]): string => `{${items.map((item) => {
    if (Array.isArray(item)) return render(item);
    if (item.kind === "null") return "NULL";
    if (item.kind === "binary" || item.kind === "unknown") {
      throw new Error("이 원소 형식의 배열은 직접 내보낼 수 없습니다. 배열을 ::text로 조회하세요.");
    }
    return `"${exportText(item).replace(/[\\"]/g, "\\$&")}"`;
  }).join(",")}}`;
  const text = render(arrayTree(v));
  const bounds = v.values.length && v.dimensions.some((d) => d.lowerBound !== 1)
    ? `${v.dimensions.map((d) => `[${d.lowerBound}:${d.lowerBound + d.length - 1}]`).join("")}=`
    : "";
  return bounds + text;
}

/** Canonical text for clipboard/export: NULL marker, lossless strings. */
export function exportText(v: DbValue | undefined): string {
  if (!v) throw new Error("결과 값이 없습니다. 쿼리를 다시 실행한 후 내보내세요.");
  if (v.kind === "null") return "NULL";
  if (v.kind === "boolean") return String(v.value);
  if (v.kind === "array") return arrayText(v);
  if (v.kind === "binary" && (v.value === null || v.truncated || v.encoding !== "base64")) {
    throw new Error("바이너리 전체 값이 없어 내보낼 수 없습니다. encode(열, 'base64')로 다시 조회하세요.");
  }
  if (v.kind === "unknown" && (v.value === "<unreadable>" || v.value === `<${v.typeName.toLowerCase()}>`)) {
    throw new Error("지원하지 않는 형식의 원본 값이 없습니다. 해당 열을 ::text로 조회한 후 내보내세요.");
  }
  return v.value!;
}

function tsvField(s: string, literal = false): string {
  return /[\t\n\r"]/.test(s) || (literal && /^(NULL|DEFAULT)?$/.test(s))
    ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toTsv(columns: ColumnMeta[], rows: DbValue[][], includeHeader: boolean): string {
  const lines: string[] = [];
  if (includeHeader) lines.push(columns.map((c) => tsvField(c.name)).join("\t"));
  for (const row of rows) {
    lines.push(
      columns
        .map((c) => {
          const v = row[c.index];
          return tsvField(exportText(v), v?.kind !== "null");
        })
        .join("\t"),
    );
  }
  return lines.join("\n");
}

function csvField(s: string, formulaDefense: boolean): string {
  // Spreadsheet formula injection defense (on by default per spec §8.2).
  const guarded = formulaDefense && /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** RFC 4180-compatible CSV with CRLF rows. */
export function toCsv(
  columns: ColumnMeta[],
  rows: DbValue[][],
  formulaDefense = true,
): string {
  const lines = [columns.map((c) => csvField(c.name, formulaDefense)).join(",")];
  for (const row of rows) {
    lines.push(
      columns
        .map((c) => {
          const v = row[c.index];
          if (v?.kind === "null") return ""; // CSV NULL = empty field
          const value = exportText(v);
          if (value === "") return '""'; // distinguish empty values, including enums and bytea
          const literal = v?.kind === "integer" || v?.kind === "decimal" || v?.kind === "float" || v?.kind === "binary";
          return csvField(value, formulaDefense && !literal);
        })
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

function jsonValue(v: DbValue | undefined): unknown {
  if (!v) throw new Error("결과 값이 없습니다. 쿼리를 다시 실행한 후 내보내세요.");
  if (v.kind === "null") return null;
  if (v.kind === "boolean") return v.value;
  if (v.kind === "array") {
    if (v.values.length && v.dimensions.some((d) => d.lowerBound !== 1)) {
      throw new Error("JSON 배열은 사용자 지정 하한을 보존할 수 없습니다. CSV 또는 TSV로 내보내세요.");
    }
    const render = (items: ArrayTree[]): unknown[] => items.map(
      (item) => Array.isArray(item) ? render(item) : jsonValue(item),
    );
    return render(arrayTree(v));
  }
  if (v.kind === "float") {
    const n = Number(v.value);
    return Number.isFinite(n) && !Object.is(n, -0) ? n : v.value;
  }
  // integers/decimals stay strings: no precision loss in JSON consumers
  return exportText(v);
}

export function toJson(columns: ColumnMeta[], rows: DbValue[][]): string {
  if (new Set(columns.map((c) => c.name)).size !== columns.length) {
    throw new Error("동일한 열 이름이 있어 JSON으로 내보낼 수 없습니다. SQL 별칭(AS)으로 열 이름을 구분하세요.");
  }
  const out = rows.map((row) =>
    Object.fromEntries(columns.map((c) => [c.name, jsonValue(row[c.index])])),
  );
  return JSON.stringify(out, null, 2);
}
