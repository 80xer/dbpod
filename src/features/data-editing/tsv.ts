export const MAX_PASTE_CELLS = 10_000;
export const MAX_PASTE_ROWS = 500;
const MAX_PASTE_BYTES = 10 * 1024 * 1024;

/**
 * Spreadsheet-compatible TSV: tab delimiter, CRLF/LF rows, double-quoted
 * fields may contain tabs/newlines with "" escapes. Trailing empty fields
 * are preserved; a single trailing newline does not add an empty row.
 */
export function parseTsv(text: string): { rows: string[][]; quoted: boolean[][]; error?: string } {
  if (text.length > MAX_PASTE_BYTES || new TextEncoder().encode(text).byteLength > MAX_PASTE_BYTES) {
    return { rows: [], quoted: [], error: "붙여넣기 데이터가 10MiB를 초과합니다" };
  }
  const rows: string[][] = [];
  const quoted: boolean[][] = [];
  let row: string[] = [];
  let rowQuoted: boolean[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  let fieldWasQuoted = false;
  let cells = 0;
  const n = text.length;

  const endField = () => {
    row.push(field);
    rowQuoted.push(fieldWasQuoted);
    cells++;
    field = "";
    fieldWasQuoted = false;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    quoted.push(rowQuoted);
    row = [];
    rowQuoted = [];
  };

  while (i < n) {
    if (cells > MAX_PASTE_CELLS) return { rows: [], quoted: [], error: "붙여넣기는 최대 10,000셀입니다" };
    if (rows.length > MAX_PASTE_ROWS) return { rows: [], quoted: [], error: "한 번에 최대 500행까지 붙여넣을 수 있습니다" };
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
      if (fieldWasQuoted || c === '"') {
        return { rows: [], quoted: [], error: "잘못된 TSV 따옴표 형식입니다. 닫는 따옴표 뒤에는 탭 또는 줄바꿈만 허용됩니다" };
      }
      field += c;
      i++;
    }
  }
  if (inQuotes) return { rows: [], quoted: [], error: "TSV 필드의 닫는 따옴표가 없습니다" };
  if (field !== "" || row.length > 0 || fieldWasQuoted) endRow();

  if (cells > MAX_PASTE_CELLS) return { rows: [], quoted: [], error: "붙여넣기는 최대 10,000셀입니다" };
  if (rows.length > MAX_PASTE_ROWS) return { rows: [], quoted: [], error: "한 번에 최대 500행까지 붙여넣을 수 있습니다" };
  return { rows, quoted };
}

export type PasteMarker = "value" | "null" | "default";

/** Only unquoted NULL and DEFAULT fields are SQL markers. */
export function interpretMarker(field: string, wasQuoted = false): { mode: PasteMarker; value?: string } {
  if (!wasQuoted && field === "NULL") return { mode: "null" };
  if (!wasQuoted && field === "DEFAULT") return { mode: "default" };
  return { mode: "value", value: field };
}
