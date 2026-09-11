import { beforeEach, expect, test, vi } from "vitest";
import { editStore } from "../../entities/result/editStore";
import { resultStore } from "../../entities/result/resultStore";
import type { ColumnMeta, TableMetadata } from "../../generated/ipc-types";
import { tableDataEditability } from "./editability";
import { applyServerValues, buildRowChanges, commitChangeSet } from "./saveChanges";
import { ipc } from "../../shared/ipc/invoke";

vi.mock("@tauri-apps/api/core", () => ({ Channel: class { onmessage = () => {}; } }));
vi.mock("../../shared/ipc/invoke", () => ({ ipc: { changesCommit: vi.fn() } }));
const columns: ColumnMeta[] = [
  { index: 0, name: "__dbpod_xmin", pgTypeOid: 25, pgTypeName: "text", category: "text", source: null, nullable: null, editable: false },
  { index: 1, name: "id", pgTypeOid: 23, pgTypeName: "int4", category: "integer", source: { relationOid: 1, attributeNumber: 1 }, nullable: false, editable: false },
  { index: 2, name: "name", pgTypeOid: 25, pgTypeName: "text", category: "text", source: { relationOid: 1, attributeNumber: 2 }, nullable: true, editable: false },
];
const meta: TableMetadata = { relationOid: 1, schema: "public", name: "target", kind: "table", primaryKey: [1], uniqueKeys: [], rowLevelSecurity: false, columns: [
  { attributeNumber: 1, name: "id", pgTypeOid: 23, pgTypeName: "integer", nullable: false, defaultExpr: null, isGenerated: false, isPrimaryKey: true },
  { attributeNumber: 2, name: "name", pgTypeOid: 25, pgTypeName: "text", nullable: true, defaultExpr: null, isGenerated: false, isPrimaryKey: false },
] };
const info = tableDataEditability(columns, meta, false);
if (!info.editable) throw new Error("invalid fixture");
const editable = info;
beforeEach(() => {
  vi.clearAllMocks(); resultStore.dispose("result"); resultStore.create("result"); resultStore.setColumns("result", columns);
  resultStore.pushRows("result", [1, 2, 3].map((id) => [{ kind: "text", value: "11" }, { kind: "integer", value: String(id) }, { kind: "text", value: "old" }]));
  resultStore.setTerminal("result", { status: "completed" });
});

test("dirty result cannot be replaced and delete uses its original displayed values", () => {
  editStore.toggleDelete("result", 0);
  expect(() => resultStore.create("result")).toThrow();
  const changes = buildRowChanges({ ...editable, lockMode: "displayed", xminColumnIndex: undefined }, resultStore.getSnapshot("result"), editStore.getSnapshot("result"));
  expect(changes[0]).toMatchObject({ operation: "delete", identity: { primaryKey: [{ value: { kind: "integer", value: "1" } }] }, originalValues: { name: { kind: "text", value: "old" } } });
});

test("server conflict clears deletes, advances xmin, and rebases other drafts together", () => {
  editStore.toggleDelete("result", 0); editStore.toggleDelete("result", 1);
  editStore.setCell("result", 2, "name", { value: "third edited" });
  applyServerValues("result", [
    { rowId: "d:0", reason: "gone", current: null },
    { rowId: "d:1", reason: "changed", current: { __dbpod_xmin: { kind: "text", value: "22" }, id: { kind: "integer", value: "2" }, name: { kind: "text", value: "new" } } },
  ], editable);
  expect(resultStore.getSnapshot("result").rows[0][0]).toEqual({ kind: "text", value: "22" });
  expect(editStore.getSnapshot("result").deletes.size).toBe(0);
  const changes = buildRowChanges(editable, resultStore.getSnapshot("result"), editStore.getSnapshot("result"));
  expect(changes[0]).toMatchObject({ rowId: "u:1", identity: { primaryKey: [{ value: { kind: "integer", value: "3" } }] } });
});

test("commit freezes edits, accepts terminal before invoke returns, applies server values once", async () => {
  editStore.setCell("result", 0, "name", { value: "pending" });
  vi.mocked(ipc.changesCommit).mockImplementation(async (_, channel) => {
    expect(editStore.getSnapshot("result").locked).toBe(true);
    editStore.setCell("result", 0, "name", { value: "late" });
    expect(editStore.getSnapshot("result").updates.get(0)?.get("name")?.value).toBe("pending");
    const event = { type: "completed" as const, rows: [{ rowId: "u:0", operation: "update", values: { name: { kind: "text" as const, value: "server" } }, xmin: "22" }] };
    channel.onmessage(event); channel.onmessage(event);
  });
  await expect(commitChangeSet("result", "preview", editable)).resolves.toEqual({ type: "completed", rowCount: 1 });
  expect(resultStore.getSnapshot("result").rows[0][2]).toEqual({ kind: "text", value: "server" });
  expect(editStore.getSnapshot("result")).toMatchObject({ pendingCount: 0, locked: false });
});

test("lost commit response unlocks but retains pending edits for recovery", async () => {
  editStore.setCell("result", 0, "name", { value: "pending" });
  vi.mocked(ipc.changesCommit).mockRejectedValue(new Error("connection lost"));
  await expect(commitChangeSet("result", "preview", editable)).rejects.toThrow("connection lost");
  expect(editStore.getSnapshot("result")).toMatchObject({ pendingCount: 1, locked: false });
});
