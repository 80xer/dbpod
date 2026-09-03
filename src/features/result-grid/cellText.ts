import type { DbValue } from "../../generated/ipc-types";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function cellText(v: DbValue | undefined): string {
  if (!v) return "";
  switch (v.kind) {
    case "null":
      return "NULL";
    case "boolean":
      return v.value ? "true" : "false";
    case "binary":
      return v.value === null
        ? `<binary ${formatBytes(v.byteLength)}>`
        : `<binary ${formatBytes(v.byteLength)} base64:${v.value.slice(0, 24)}…>`;
    case "array":
      return `{${v.values.map(cellText).join(",")}}`;
    default:
      return v.value;
  }
}

export function cellClass(v: DbValue | undefined): string {
  if (!v) return "";
  switch (v.kind) {
    case "null":
      return "text-gray-400 italic";
    case "unknown":
    case "composite":
    case "binary":
      return "text-gray-400";
    case "integer":
    case "decimal":
    case "float":
      return "text-right tabular-nums";
    default:
      return "";
  }
}
