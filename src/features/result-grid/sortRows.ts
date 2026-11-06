import type { DbValue } from "../../generated/ipc-types";
import { cellText } from "./cellText";

const collator = new Intl.Collator();
const DECIMAL = /^(-?)(\d*)(?:\.(\d*))?$/;
// PostgreSQL orders numeric/float specials as -Infinity < finite < Infinity < NaN.
const SPECIAL_RANK: Record<string, number> = { "-Infinity": -1, Infinity: 1, NaN: 2 };

/** Exact comparison of PostgreSQL numeric text, so values past 2^53 keep their order. */
function compareDecimal(a: string, b: string): number {
  const ma = DECIMAL.exec(a);
  const mb = DECIMAL.exec(b);
  if (!ma || !mb) return (SPECIAL_RANK[a] ?? 0) - (SPECIAL_RANK[b] ?? 0) || collator.compare(a, b);
  const parse = (m: RegExpExecArray) => {
    const int = m[2].replace(/^0+/, "");
    const frac = (m[3] ?? "").replace(/0+$/, "");
    return { negative: m[1] === "-" && Boolean(int || frac), int, frac };
  };
  const x = parse(ma);
  const y = parse(mb);
  if (x.negative !== y.negative) return x.negative ? -1 : 1;
  const intWidth = Math.max(x.int.length, y.int.length);
  const fracWidth = Math.max(x.frac.length, y.frac.length);
  // Padded to the same width, digit strings order like the numbers they spell.
  const [dx, dy] = [x, y].map((n) => n.int.padStart(intWidth, "0") + n.frac.padEnd(fracWidth, "0"));
  const magnitude = dx < dy ? -1 : dx > dy ? 1 : 0;
  return x.negative ? -magnitude : magnitude;
}

function compareFloat(a: string, b: string): number {
  const x = Number(a);
  const y = Number(b);
  if (Number.isNaN(x) || Number.isNaN(y)) return Number(Number.isNaN(x)) - Number(Number.isNaN(y));
  return x - y;
}

/** Non-null values of one column; the category decides the comparison (result_grid_spec 9.3). */
function compareValues(a: DbValue, b: DbValue): number {
  if (a.kind === "boolean" && b.kind === "boolean") return Number(a.value) - Number(b.value);
  if ((a.kind === "integer" || a.kind === "decimal") && (b.kind === "integer" || b.kind === "decimal")) return compareDecimal(a.value, b.value);
  if (a.kind === "float" && b.kind === "float") return compareFloat(a.value, b.value);
  if (a.kind === "temporal" && b.kind === "temporal") {
    // Instants compare by time across offsets; times of day and intervals fall back to text.
    const x = Date.parse(a.value);
    const y = Date.parse(b.value);
    if (Number.isFinite(x) && Number.isFinite(y) && x !== y) return x - y;
  }
  return collator.compare(cellText(a), cellText(b));
}

/**
 * Display order of the loaded rows sorted by one column: row indexes into `rows`.
 * NULLs go last in both directions; equal values keep their fetched order.
 */
export function sortedRowOrder(rows: DbValue[][], columnIndex: number, descending: boolean): number[] {
  return rows.map((_, i) => i).sort((i, j) => {
    const a = rows[i][columnIndex];
    const b = rows[j][columnIndex];
    const aNull = !a || a.kind === "null";
    const bNull = !b || b.kind === "null";
    if (aNull || bNull) return Number(aNull) - Number(bNull) || i - j;
    return (descending ? -compareValues(a, b) : compareValues(a, b)) || i - j;
  });
}
