import { describe, expect, it } from "vitest";
import { interpretMarker, parseTsv } from "./tsv";

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

  it("single trailing newline does not create an empty row", () => {
    expect(parseTsv("a\n").rows).toEqual([["a"]]);
  });

  it("rejects oversized paste", () => {
    const big = Array.from({ length: 501 }, () => "x").join("\n");
    expect(parseTsv(big).error).toMatch(/500행/);
  });
});

describe("interpretMarker", () => {
  it("maps NULL and DEFAULT markers", () => {
    expect(interpretMarker("NULL")).toEqual({ mode: "null" });
    expect(interpretMarker("DEFAULT")).toEqual({ mode: "default" });
    expect(interpretMarker("null")).toEqual({ mode: "value", value: "null" });
    expect(interpretMarker("")).toEqual({ mode: "value", value: "" });
  });
});
