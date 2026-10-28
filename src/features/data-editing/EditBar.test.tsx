// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { EditBar } from "./EditBar";
import { editStore } from "../../entities/result/editStore";
import { resultStore } from "../../entities/result/resultStore";
import { ipc } from "../../shared/ipc/invoke";
import type { EditableInfo } from "./editability";
import type { ChangesCommitEvent, ChangesPreviewResponse } from "../../generated/ipc-types";

vi.mock("@tauri-apps/api/core", () => ({ Channel: class { onmessage = (_event: ChangesCommitEvent) => {}; } }));
vi.mock("../../shared/ipc/invoke", () => ({ ipc: { changesPreview: vi.fn(), changesCommit: vi.fn(), changesDiscard: vi.fn() } }));

const info: EditableInfo = {
  editable: true, relationOid: 42, pk: [{ attributeNumber: 1, columnName: "id", columnIndex: 0 }],
  editableColumns: new Set(["id"]), catalogName: { id: "id" }, lockMode: "displayed",
  meta: { relationOid: 42, schema: "adm", name: "menus", kind: "table", primaryKey: [1], columns: [], uniqueKeys: [], rowLevelSecurity: false },
};
const preview: ChangesPreviewResponse = {
  changeSetId: "preview", expiresAt: "2099-01-01T00:00:00Z", target: { schema: "adm", table: "menus" },
  counts: { insert: 0, update: 1, delete: 0 }, statements: [], warnings: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  resultStore.dispose("edit-bar");
  resultStore.create("edit-bar");
  resultStore.setColumns("edit-bar", [{ index: 0, name: "id", pgTypeOid: 20, pgTypeName: "bigint", category: "integer", source: { relationOid: 42, attributeNumber: 1 }, nullable: false, editable: true }]);
  resultStore.pushRows("edit-bar", [[{ kind: "integer", value: "1" }]]);
  editStore.setCell("edit-bar", 0, "id", { value: "2" });
  vi.mocked(ipc.changesPreview).mockResolvedValue(preview);
  vi.mocked(ipc.changesDiscard).mockResolvedValue(undefined);
  render(<EditBar connectionId="target" resultTabId="edit-bar" editability={info} />);
});
afterEach(() => { cleanup(); resultStore.dispose("edit-bar"); vi.restoreAllMocks(); });

async function save() {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "저장…" })); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "트랜잭션으로 저장" })); });
}

test("keeps database constraint errors visible in a dialog and retains drafts for correction", async () => {
  const error = { code: "POSTGRES_ERROR", message: 'duplicate key value violates unique constraint "menus_pkey"', sqlState: "23505", retryable: false, detail: null, hint: null, position: null };
  vi.mocked(ipc.changesCommit).mockImplementation(async (_, channel) => { channel.onmessage({ type: "failed", error }); });
  await save();
  const dialog = screen.getByRole("dialog", { name: "저장 오류" });
  expect(within(dialog).getByRole("alert").textContent).toContain(error.message);
  expect(dialog.textContent).toContain("23505");
  expect(dialog.textContent).toContain("중복");
  expect(editStore.getSnapshot("edit-bar")).toMatchObject({ pendingCount: 1, locked: false });
  expect(resultStore.getSnapshot("edit-bar").rows[0][0]).toEqual({ kind: "integer", value: "1" });
  fireEvent.click(within(dialog).getByRole("button", { name: "편집으로 돌아가기" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(ipc.changesDiscard).not.toHaveBeenCalled();
});

test("shows invoke failures in the same error dialog", async () => {
  vi.mocked(ipc.changesCommit).mockRejectedValue(new Error("connection lost"));
  await save();
  expect(within(screen.getByRole("dialog", { name: "저장 오류" })).getByRole("alert").textContent).toContain("connection lost");
  expect(editStore.getSnapshot("edit-bar").pendingCount).toBe(1);
});

test("shows a busy state until the commit result arrives, then clears drafts only on success", async () => {
  let finish!: () => void;
  vi.mocked(ipc.changesCommit).mockImplementation((_, channel) => new Promise<void>((resolve) => {
    finish = () => { channel.onmessage({ type: "completed", rows: [{ rowId: "u:0", operation: "update", xmin: "12", values: { id: { kind: "integer", value: "2" } } }] }); resolve(); };
  }));
  await save();
  const dialog = screen.getByRole("dialog", { name: "변경 사항 확인" });
  expect(within(dialog).getByRole("status").textContent).toContain("저장 중");
  expect((within(dialog).getByRole("button", { name: "취소" }) as HTMLButtonElement).disabled).toBe(true);
  expect(editStore.getSnapshot("edit-bar").pendingCount).toBe(1);
  await act(async () => { finish(); });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("저장됨: 1행 반영");
  expect(editStore.getSnapshot("edit-bar")).toMatchObject({ pendingCount: 0, locked: false });
});
