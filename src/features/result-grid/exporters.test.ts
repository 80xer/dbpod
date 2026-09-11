import { describe, expect, it } from "vitest";
import type { ColumnMeta, DbValue } from "../../generated/ipc-types";
import { exportText, toCsv, toJson, toTsv } from "./exporters";
import { parseTsv } from "../data-editing/tsv";

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
const array = (values: DbValue[], dimensions = [{ lowerBound: 1, length: values.length }]): DbValue => ({
  kind: "array", values, dimensions, elementTypeOid: 25,
});
const rows: DbValue[][] = [
  [t("plain"), { kind: "null" }],
  [t(""), t("tab\there")],
  [t("=SUM(A1)"), { kind: "integer", value: "9007199254740993" }],
];

describe("toTsv", () => {
  it("uses NULL marker and quotes empty strings and specials", () => {
    const out = toTsv(columns, rows, true).split("\n");
    expect(out[0]).toBe("a\tb");
    expect(out[1]).toBe("plain\tNULL");
    expect(out[2]).toBe('""\t"tab\there"');
  });

  it("quotes literal markers so paste can distinguish them from SQL NULL and DEFAULT", () => {
    expect(toTsv([col(0, "a")], [[t("NULL")], [t("DEFAULT")], [{ kind: "null" }], [t("")]], false))
      .toBe('"NULL"\n"DEFAULT"\nNULL\n""');
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

  it("keeps exact negative numeric strings while protecting text formulas", () => {
    const values: DbValue[][] = [[
      { kind: "integer", value: "-9007199254740993" },
      { kind: "decimal", value: "-12345678901234567890.00100" },
    ]];
    expect(toCsv(columns, values)).toBe("a,b\r\n-9007199254740993,-12345678901234567890.00100\r\n");
    expect(JSON.parse(toJson(columns, values))[0]).toEqual({
      a: "-9007199254740993", b: "-12345678901234567890.00100",
    });
  });
});

describe("toJson", () => {
  it("keeps big integers as lossless strings", () => {
    const parsed = JSON.parse(toJson(columns, rows)) as Array<Record<string, unknown>>;
    expect(parsed[0].b).toBeNull();
    expect(parsed[2].b).toBe("9007199254740993");
  });

  it("rejects duplicate names instead of discarding columns", () => {
    expect(() => toJson([col(0, "same"), col(1, "same")], rows)).toThrow(/AS/);
  });

  it("preserves raw JSON numbers and special floats", () => {
    const values: DbValue[][] = [[
      { kind: "json", jsonType: "jsonb", value: '{"large":9007199254740993}' },
      { kind: "float", value: "-0" },
    ]];
    expect(JSON.parse(toJson(columns, values))[0]).toEqual({ a: '{"large":9007199254740993}', b: "-0" });
  });
});

describe("array export", () => {
  it("preserves element boundaries, literal NULL, empty strings, quotes and backslashes", () => {
    const value = array([t("a,b"), t("NULL"), { kind: "null" }, t(""), t('a"b\\c'), t("{x}"), t(" line\n")]);
    const expected = String.raw`{"a,b","NULL",NULL,"","a\"b\\c","{x}"," line` + '\n"}';
    expect(exportText(value)).toBe(expected);
    expect(parseTsv(toTsv([col(0, "items")], [[value]], false)).rows).toEqual([[expected]]);
    expect(JSON.parse(toJson([col(0, "items")], [[value]]))[0].items)
      .toEqual(["a,b", "NULL", null, "", 'a"b\\c', "{x}", " line\n"]);
  });

  it("reconstructs row-major dimensions and keeps bounds in PostgreSQL text", () => {
    const values: DbValue[] = [
      { kind: "integer", value: "9007199254740993" }, { kind: "null" },
      { kind: "decimal", value: "12.3400" }, { kind: "boolean", value: true },
    ];
    const dims = [{ lowerBound: 1, length: 2 }, { lowerBound: 1, length: 2 }];
    expect(JSON.parse(toJson([col(0, "items")], [[array(values, dims)]]))[0].items)
      .toEqual([["9007199254740993", null], ["12.3400", true]]);
    dims[0].lowerBound = -2;
    expect(exportText(array(values, dims))).toBe('[-2:-1][1:2]={{"9007199254740993",NULL},{"12.3400","true"}}');
    expect(() => toJson([col(0, "items")], [[array(values, dims)]])).toThrow(/CSV/);
    expect(exportText(array([]))).toBe("{}");
    expect(() => exportText(array(values, [{ lowerBound: 1, length: 3 }]))).toThrow(/차원/);
  });
});

describe("unavailable export values", () => {
  it("rejects binary handles, truncation and unknown placeholders in every format", () => {
    const binary: DbValue = {
      kind: "binary", encoding: "base64", value: null,
      byteLength: 200000, truncated: true, valueHandle: "binary-handle",
    };
    const unavailable: DbValue[] = [
      binary,
      { ...binary, value: "YWJj" },
      { kind: "unknown", value: "<point>", typeOid: 600, typeName: "POINT" },
      { kind: "unknown", value: "<unreadable>", typeOid: 0, typeName: "" },
    ];
    for (const value of unavailable) {
      expect(() => toCsv([col(0, "value")], [[value]])).toThrow(/조회/);
      expect(() => toTsv([col(0, "value")], [[value]], false)).toThrow(/조회/);
      expect(() => toJson([col(0, "value")], [[value]])).toThrow(/조회/);
    }
    expect(exportText({ ...binary, value: "+w==", byteLength: 1, truncated: false, valueHandle: null })).toBe("+w==");
    expect(exportText({ kind: "unknown", value: "(0,0)", typeOid: 600, typeName: "POINT" })).toBe("(0,0)");
    expect(() => toJson([col(0, "missing")], [[]])).toThrow(/다시 실행/);
  });
});
