import { expect, test } from "vitest";
import type { DbValue } from "../../generated/ipc-types";
import { cellText } from "./cellText";
import { sortedRowOrder } from "./sortRows";

const sorted = (values: DbValue[], descending = false) =>
  sortedRowOrder(values.map((v) => [v]), 0, descending).map((i) => cellText(values[i]));
const kind = <K extends "integer" | "decimal" | "float" | "text">(k: K) => (value: string) => ({ kind: k, value }) as DbValue;

test("orders exact numerics by value past float precision, with signs, scales and specials", () => {
  const values = ["10", "-0.50", "9007199254740993", "9007199254740992", "2.5", "-10", "NaN", "0.000", "-Infinity", "Infinity", "2.50001"].map(kind("decimal"));
  expect(sorted(values))
    .toEqual(["-Infinity", "-10", "-0.50", "0.000", "2.5", "2.50001", "10", "9007199254740992", "9007199254740993", "Infinity", "NaN"]);
});

test("orders floats numerically with NaN last and text by locale", () => {
  expect(sorted(["10", "NaN", "-Infinity", "9.5"].map(kind("float")))).toEqual(["-Infinity", "9.5", "10", "NaN"]);
  expect(sorted(["b", "a10", "A", "a2"].map(kind("text")))).toEqual(["A", "a10", "a2", "b"].sort(new Intl.Collator().compare));
});

test("keeps NULLs last in both directions and ties in fetched order", () => {
  const rows: DbValue[][] = [[{ kind: "null" }], [{ kind: "integer", value: "2" }], [{ kind: "integer", value: "1" }], [{ kind: "integer", value: "1" }]];
  expect(sortedRowOrder(rows, 0, false)).toEqual([2, 3, 1, 0]);
  expect(sortedRowOrder(rows, 0, true)).toEqual([1, 2, 3, 0]);
});

test("orders timestamps with offsets by instant", () => {
  const t = (value: string): DbValue => ({ kind: "temporal", temporalType: "timestamptz", value } as DbValue);
  expect(sortedRowOrder([[t("2026-01-01T09:00:00+09:00")], [t("2026-01-01T01:00:00+00:00")]], 0, false)).toEqual([0, 1]);
});
