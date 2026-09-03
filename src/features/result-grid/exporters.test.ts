import { describe, expect, it } from "vitest";
import type { ColumnMeta, DbValue } from "../../generated/ipc-types";
import { toCsv, toJson, toTsv } from "./exporters";

const col = (index: number, name: string): ColumnMeta => ({
  index,
  name,
  pgTypeOid: 25,
  pgTypeName: "TEXT",
  category: "text",
  source: null,
  nullable: null,
  editable: false,
});

const columns = [col(0, "a"), col(1, "b")];
const t = (value: string): DbValue => ({ kind: "text", value });
const rows: DbValue[][] = [
  [t("plain"), { kind: "null" }],
  [t(""), t("tab\there")],
  [t("=SUM(A1)"), { kind: "integer", value: "9007199254740993" }],
];

describe("toTsv", () => {
  it("uses NULL marker, keeps empty string empty, quotes specials", () => {
    const out = toTsv(columns, rows, true).split("\n");
    expect(out[0]).toBe("a\tb");
    expect(out[1]).toBe("plain\tNULL");
    expect(out[2]).toBe('\t"tab\there"');
  });
});

describe("toCsv", () => {
  it("defends against formula injection by default and distinguishes NULL/empty", () => {
    const lines = toCsv(columns, rows).split("\r\n");
    expect(lines[1]).toBe("plain,"); // NULL -> empty field
    expect(lines[2]).toBe('"",tab\there'); // empty string -> quoted empty
    expect(lines[3].startsWith("'=SUM(A1)")).toBe(true);
  });

  it("raw mode keeps formulas verbatim", () => {
    const lines = toCsv(columns, rows, false).split("\r\n");
    expect(lines[3].startsWith("=SUM(A1)")).toBe(true);
  });
});

describe("toJson", () => {
  it("keeps big integers as lossless strings", () => {
    const parsed = JSON.parse(toJson(columns, rows)) as Array<Record<string, unknown>>;
    expect(parsed[0].b).toBeNull();
    expect(parsed[2].b).toBe("9007199254740993");
  });
});
