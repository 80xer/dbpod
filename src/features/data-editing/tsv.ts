export const MAX_PASTE_CELLS = 10_000;
export const MAX_PASTE_ROWS = 500;
const MAX_PASTE_BYTES = 10 * 1024 * 1024;

/**
 * Spreadsheet-compatible TSV: tab delimiter, CRLF/LF rows, double-quoted
 * fields may contain tabs/newlines with "" escapes. Trailing empty fields
 * are preserved; a single trailing newline does not add an empty row.
 */
export function parseTsv(text: string): { rows: string[][]; error?: string } {
  if (text.length > MAX_PASTE_BYTES) return { rows: [], error: "붙여넣기 데이터가 10MiB를 초과합니다" };
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  let fieldWasQuoted = false;
  const n = text.length;

  const endField = () => {
    row.push(field);
    field = "";
    fieldWasQuoted = false;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += c;
        i++;
      }
    } else if (c === '"' && field === "" && !fieldWasQuoted) {
      inQuotes = true;
      fieldWasQuoted = true;
      i++;
    } else if (c === "\t") {
      endField();
      i++;
    } else if (c === "\n") {
      endRow();
      i++;
    } else if (c === "\r") {
      endRow();
      if (text[i + 1] === "\n") i += 2;
      else i++;
    } else {
      field += c;
      i++;
    }
  }
  if (field !== "" || row.length > 0 || fieldWasQuoted) endRow();

  const cells = rows.reduce((a, r) => a + r.length, 0);
  if (cells > MAX_PASTE_CELLS) return { rows: [], error: "붙여넣기는 최대 10,000셀입니다" };
  if (rows.length > MAX_PASTE_ROWS) return { rows: [], error: "한 번에 최대 500행까지 붙여넣을 수 있습니다" };
  return { rows };
}

export type PasteMarker = "value" | "null" | "default";

/** Default marker interpretation: literal NULL -> SQL NULL, DEFAULT -> default. */
export function interpretMarker(field: string): { mode: PasteMarker; value?: string } {
  if (field === "NULL") return { mode: "null" };
  if (field === "DEFAULT") return { mode: "default" };
  return { mode: "value", value: field };
}
