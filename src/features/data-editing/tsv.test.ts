import { describe, expect, it } from "vitest";
import { interpretMarker, parseTsv } from "./tsv";
import type { ColumnMeta, DbValue } from "../../generated/ipc-types";
import { toTsv } from "../result-grid/exporters";

describe("parseTsv", () => {
  it("parses simple rows with LF and CRLF", () => {
    expect(parseTsv("a\tb\nc\td").rows).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(parseTsv("a\tb\r\nc\td\r\n").rows).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("keeps trailing empty fields", () => {
    expect(parseTsv("a\t\t\nb\t\t").rows).toEqual([
      ["a", "", ""],
      ["b", "", ""],
    ]);
  });

  it("handles quoted fields with embedded tabs, newlines and quotes", () => {
    expect(parseTsv('"a\tb"\t"line1\nline2"\t"say ""hi"""').rows).toEqual([
      ["a\tb", "line1\nline2", 'say "hi"'],
    ]);
  });

  it("preserves quote metadata at the same row and column positions", () => {
    const parsed = parseTsv('"NULL"\tNULL\t""\t\r\nDEFAULT\t"DEFAULT"');
    expect(parsed.rows).toEqual([["NULL", "NULL", "", ""], ["DEFAULT", "DEFAULT"]]);
    expect(parsed.quoted).toEqual([[true, false, true, false], [false, true]]);
    expect(parseTsv('""\r\n')).toEqual({ rows: [[""]], quoted: [[true]] });
    expect(parseTsv("")).toEqual({ rows: [], quoted: [] });
  });

  it("rejects malformed quoting without returning partial rows", () => {
    for (const text of ['"unfinished', 'ok\n"unfinished', '"closed"x', '"closed" ', 'unquoted"quote']) {
      const parsed = parseTsv(text);
      expect(parsed.error).toMatch(/따옴표/);
      expect(parsed.rows).toEqual([]);
      expect(parsed.quoted).toEqual([]);
    }
  });

  it("single trailing newline does not create an empty row", () => {
    expect(parseTsv("a\n").rows).toEqual([["a"]]);
  });

  it("rejects oversized paste", () => {
    const big = Array.from({ length: 501 }, () => "x").join("\n");
    expect(parseTsv(big).error).toMatch(/500행/);
    expect(parseTsv("x\t".repeat(10000)).error).toMatch(/10,000셀/);
    // Fewer than 10 Mi characters, but over 10 MiB of UTF-8 bytes.
    expect(parseTsv("한".repeat(Math.floor(10 * 1024 * 1024 / 3) + 1)).error).toMatch(/10MiB/);
  });
});

describe("interpretMarker", () => {
  it("maps NULL and DEFAULT markers", () => {
    expect(interpretMarker("NULL")).toEqual({ mode: "null" });
    expect(interpretMarker("DEFAULT")).toEqual({ mode: "default" });
    expect(interpretMarker("null")).toEqual({ mode: "value", value: "null" });
    expect(interpretMarker("")).toEqual({ mode: "value", value: "" });
    expect(interpretMarker("NULL", true)).toEqual({ mode: "value", value: "NULL" });
    expect(interpretMarker("DEFAULT", true)).toEqual({ mode: "value", value: "DEFAULT" });
  });

  it("round-trips exported NULL, literal markers and quoted empty values", () => {
    const column: ColumnMeta = {
      index: 0, name: "value", pgTypeOid: 25, pgTypeName: "TEXT", category: "text",
      source: null, nullable: true, editable: true,
    };
    const rows: DbValue[][] = [
      [{ kind: "null" }],
      ...["NULL", "DEFAULT", "", 'tabs\tand\n"quotes"'].map((value): DbValue[] => [{ kind: "text", value }]),
    ];
    const parsed = parseTsv(toTsv([column], rows, false));
    expect(parsed.error).toBeUndefined();
    expect(parsed.rows.map((row, index) => interpretMarker(row[0], parsed.quoted[index][0]))).toEqual([
      { mode: "null" },
      { mode: "value", value: "NULL" },
      { mode: "value", value: "DEFAULT" },
      { mode: "value", value: "" },
      { mode: "value", value: 'tabs\tand\n"quotes"' },
    ]);
  });
});
