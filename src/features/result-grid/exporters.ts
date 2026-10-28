import type { ColumnMeta, DbValue } from "../../generated/ipc-types";

import { arrayTree, exportText, type ArrayTree } from "../../entities/result/valueText";
export { exportText } from "../../entities/result/valueText";

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
