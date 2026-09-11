import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ColumnCategory, ColumnMeta, TableMetadata } from "../../generated/ipc-types";
import { ipc } from "../../shared/ipc/invoke";
import { queryEditability, tableDataEditability } from "./editability";

vi.mock("../../shared/ipc/invoke", () => ({ ipc: { metadataGetTable: vi.fn() } }));

const meta: TableMetadata = {
  relationOid: 42,
  schema: "public",
  name: "people",
  kind: "table",
  columns: [
    { attributeNumber: 1, name: "id", pgTypeOid: 23, pgTypeName: "integer", nullable: false, defaultExpr: null, isGenerated: false, isPrimaryKey: true },
    { attributeNumber: 2, name: "name", pgTypeOid: 25, pgTypeName: "text", nullable: true, defaultExpr: null, isGenerated: false, isPrimaryKey: false },
  ],
  primaryKey: [1],
  uniqueKeys: [],
  rowLevelSecurity: false,
};

const columns: ColumnMeta[] = meta.columns.map((column, index) => ({
  index,
  name: column.name,
  pgTypeOid: column.pgTypeOid,
  pgTypeName: column.pgTypeName,
  category: index === 0 ? "integer" : "text",
  source: { relationOid: meta.relationOid, attributeNumber: column.attributeNumber },
  nullable: column.nullable,
  editable: false,
}));
const xmin: ColumnMeta = { index: 0, name: "__dbpod_xmin", pgTypeOid: 25, pgTypeName: "TEXT", category: "text", source: null, nullable: null, editable: false };
const tableColumns = [xmin, ...columns.map((column) => ({ ...column, index: column.index + 1 }))];
const detect = (sql = "SELECT id, name FROM people", resultColumns = columns) =>
  queryEditability("connection", sql, resultColumns, false);

beforeEach(() => {
  vi.mocked(ipc.metadataGetTable).mockReset().mockResolvedValue(meta);
});

describe("query editability", () => {
  it.each([
    "SELECT id, name FROM people",
    "SELECT * FROM public.people WHERE id IN (1, 2) ORDER BY name, id LIMIT 20 OFFSET 1;",
    "SELECT p.id, p.name FROM public.people AS p WHERE name = 'JOIN, FROM x'",
    'SELECT "id", "name" FROM "public"."people" AS "p"',
    'SELECT id, name FROM "FROM, JOIN table"',
    "/* leading /* nested */ comment */ SELECT id, name FROM people -- trailing\n",
  ])("keeps a plain single-table SELECT editable: %s", async (sql) => {
    const result = await detect(sql);
    expect(result.editable).toBe(true);
    if (!result.editable) return;
    expect(result.lockMode).toBe("displayed");
    expect(result.xminColumnIndex).toBeUndefined();
    expect(result.pk).toEqual([{ attributeNumber: 1, columnName: "id", columnIndex: 0 }]);
    expect([...result.editableColumns]).toEqual(["id", "name"]);
  });

  it.each([
    "SELECT a.id, a.name FROM people a, people b",
    "SELECT a.id, a.name FROM people a CROSS JOIN people b",
    "SELECT id, name FROM people, generate_series(1, 2) WHERE id > 0",
    "SELECT id, name FROM (SELECT * FROM people) p",
    "SELECT id, name FROM people WHERE EXISTS (SELECT 1 FROM people)",
    "SELECT id, name FROM people WHERE EXISTS (TABLE other_people)",
    "SELECT DISTINCT id, name FROM people",
    "SELECT id, count(*) FROM people GROUP BY id",
    "SELECT id, name FROM people UNION SELECT id, name FROM people",
    "SELECT id, name FROM people; SELECT id, name FROM people",
    "WITH p AS (SELECT * FROM people) SELECT id, name FROM p",
    "SELECT id, upper(name) AS name FROM people",
    "SELECT id, name FROM people TABLESAMPLE SYSTEM (50)",
  ])("rejects a query whose target cannot be proved: %s", async (sql) => {
    expect((await detect(sql)).editable).toBe(false);
    expect(ipc.metadataGetTable).not.toHaveBeenCalled();
  });

  it("supports safe aliases by catalog attribute, without trusting xmin aliases", async () => {
    const aliased = columns.map((column, i) => ({ ...column, name: i === 0 ? "key" : "label" }));
    const result = await detect("SELECT id AS key, name AS label FROM people", aliased);
    expect(result.editable).toBe(true);
    if (result.editable) expect(result.catalogName).toEqual({ key: "id", label: "name" });
    expect((await detect("SELECT id, name AS __dbpod_xmin FROM people", [columns[0], { ...columns[1], name: "__dbpod_xmin" }])).editable).toBe(false);
    expect((await detect("SELECT id, name, '123' AS __dbpod_xmin FROM people", [...columns, { ...xmin, index: 2 }])).editable).toBe(false);
  });

  it("rejects duplicate display names, duplicate origins, missing origins and mixed relations", async () => {
    for (const column of [
      { ...columns[1], name: "id" },
      { ...columns[1], source: columns[0].source },
      { ...columns[1], source: null },
      { ...columns[1], source: { relationOid: 43, attributeNumber: 2 } },
      { ...columns[1], source: { relationOid: 42, attributeNumber: 99 } },
      { ...columns[1], pgTypeOid: 1043 },
      { ...columns[1], index: 0 },
    ]) {
      expect((await detect(undefined, [columns[0], column])).editable).toBe(false);
    }
    expect((await detect("SELECT name FROM people", [{ ...columns[1], index: 0 }])).editable).toBe(false);
  });

  it.each(["__proto__", "constructor", "prototype", "toString"])("rejects unsafe alias %s", async (name) => {
    expect((await detect(`SELECT id, name AS "${name}" FROM people`, [columns[0], { ...columns[1], name }])).editable).toBe(false);
  });

  it.each<ColumnCategory>(["array", "binary", "range", "composite", "unknown"])("rejects %s values without a reliable displayed-value lock", async (category) => {
    expect((await detect(undefined, [columns[0], { ...columns[1], category }])).editable).toBe(false);
  });

  it.each([114, 142])("rejects type OID %s without an equality operator", async (pgTypeOid) => {
    vi.mocked(ipc.metadataGetTable).mockResolvedValue({ ...meta, columns: [meta.columns[0], { ...meta.columns[1], pgTypeOid }] });
    expect((await detect(undefined, [columns[0], { ...columns[1], category: pgTypeOid === 114 ? "json" : "text", pgTypeOid }])).editable).toBe(false);
  });

  it("fails closed for read-only connections, missing metadata, views and stale relation metadata", async () => {
    expect((await queryEditability("connection", "SELECT * FROM people", columns, true)).editable).toBe(false);
    expect(ipc.metadataGetTable).not.toHaveBeenCalled();
    vi.mocked(ipc.metadataGetTable).mockRejectedValueOnce(new Error("gone"));
    expect((await detect()).editable).toBe(false);
    vi.mocked(ipc.metadataGetTable).mockResolvedValueOnce({ ...meta, kind: "view" });
    expect((await detect()).editable).toBe(false);
    vi.mocked(ipc.metadataGetTable).mockResolvedValueOnce({ ...meta, relationOid: 43 });
    expect((await detect()).editable).toBe(false);
  });
});

describe("Table Data editability", () => {
  it("trusts only the synthetic xmin projection supplied by Table Data", () => {
    const result = tableDataEditability(tableColumns, meta, false);
    expect(result.editable).toBe(true);
    if (!result.editable) return;
    expect(result.lockMode).toBe("xmin");
    expect(result.xminColumnIndex).toBe(0);
    expect(result.pk[0].columnIndex).toBe(1);
    expect([...result.editableColumns]).toEqual(["id", "name"]);
    for (const badXmin of [{ ...xmin, source: columns[0].source }, { ...xmin, pgTypeOid: 23 }, { ...xmin, category: "unknown" as const }]) {
      expect(tableDataEditability([badXmin, ...tableColumns.slice(1)], meta, false).editable).toBe(false);
    }
    expect(tableDataEditability(columns, meta, false).editable).toBe(false);
    expect(tableDataEditability([...tableColumns, { ...xmin, index: 3 }], meta, false).editable).toBe(false);
  });

  it("keeps unsupported non-PK cells read-only while xmin protects supported edits", () => {
    const result = tableDataEditability([tableColumns[0], tableColumns[1], { ...tableColumns[2], category: "binary" }], meta, false);
    expect(result.editable).toBe(true);
    if (result.editable) expect([...result.editableColumns]).toEqual(["id"]);
    expect(tableDataEditability([tableColumns[0], { ...tableColumns[1], category: "binary" }, tableColumns[2]], meta, false).editable).toBe(false);
  });

  it("rejects a real catalog xmin alias collision and unsafe catalog names", () => {
    for (const name of ["__dbpod_xmin", "__proto__"]) {
      expect(tableDataEditability(tableColumns, { ...meta, columns: [...meta.columns, { ...meta.columns[1], attributeNumber: 3, name }] }, false).editable).toBe(false);
    }
  });
});
