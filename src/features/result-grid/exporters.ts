import type { ColumnMeta, DbValue } from "../../generated/ipc-types";
import { cellText } from "./cellText";

/** Canonical text for clipboard/export: NULL marker, lossless strings. */
export function exportText(v: DbValue | undefined): string {
  if (!v || v.kind === "null") return "NULL";
  if (v.kind === "binary") return v.value ?? `<binary ${v.byteLength} bytes>`;
  return cellText(v);
}

function tsvField(s: string): string {
  return /[\t\n\r"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toTsv(columns: ColumnMeta[], rows: DbValue[][], includeHeader: boolean): string {
  const lines: string[] = [];
  if (includeHeader) lines.push(columns.map((c) => tsvField(c.name)).join("\t"));
  for (const row of rows) {
    lines.push(
      columns
        .map((c) => {
          const v = row[c.index];
          return v?.kind === "text" && v.value === "" ? "" : tsvField(exportText(v));
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
          if (!v || v.kind === "null") return ""; // CSV NULL = empty field
          if (v.kind === "text" && v.value === "") return '""'; // distinguish empty string
          return csvField(exportText(v), formulaDefense);
        })
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

function jsonValue(v: DbValue | undefined): unknown {
  if (!v || v.kind === "null") return null;
  if (v.kind === "boolean") return v.value;
  if (v.kind === "float") {
    const n = Number(v.value);
    return Number.isFinite(n) ? n : v.value;
  }
  // integers/decimals stay strings: no precision loss in JSON consumers
  return exportText(v);
}

export function toJson(columns: ColumnMeta[], rows: DbValue[][]): string {
  const out = rows.map((row) =>
    Object.fromEntries(columns.map((c) => [c.name, jsonValue(row[c.index])])),
  );
  return JSON.stringify(out, null, 2);
}
