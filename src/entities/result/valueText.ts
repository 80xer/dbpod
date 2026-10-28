import type { DbValue } from "../../generated/ipc-types";

type ArrayValue = Extract<DbValue, { kind: "array" }>;
export type ArrayTree = DbValue | ArrayTree[];

/** Dimensions describe a row-major flat payload, not nested DbValues. */
export function arrayTree(v: ArrayValue): ArrayTree[] {
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

