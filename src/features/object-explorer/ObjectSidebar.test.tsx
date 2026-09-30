// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DatabaseObjectSummary } from "../../generated/ipc-types";
import { ipc } from "../../shared/ipc/invoke";
import { ObjectSidebar, resetExpansionState } from "./ObjectSidebar";
import { confirmDialog } from "../../shared/ui/prompt";

vi.mock("../../shared/ui/prompt", () => ({ confirmDialog: vi.fn() }));
vi.mock("../../shared/ipc/invoke", () => ({
  ipc: { metadataListDatabases: vi.fn(), metadataListSchemas: vi.fn(), metadataListObjects: vi.fn(), metadataDropObject: vi.fn() },
}));

const table = (oid: number, name: string, partitionParentOid: number | null = null): DatabaseObjectSummary => ({
  oid, name, schema: "public", kind: "table", partitionParentOid,
  canSelect: true, canInsert: true, canUpdate: true, canDelete: true,
});
const parent = table(10, "orders");
const branch = table(11, "orders_2026", 10);
const leaf = { ...table(12, "september", 11), schema: "archive" };
const denied = { ...table(13, "restricted", 10), canSelect: false };
let client: QueryClient;
const onOpenObject = vi.fn();
const onChangeDatabase = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  resetExpansionState();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(ipc.metadataListDatabases).mockResolvedValue([{ name: "postgres", canConnect: true }, { name: "analytics", canConnect: true }, { name: "template0", canConnect: false }]);
  vi.mocked(ipc.metadataListSchemas).mockResolvedValue([{ oid: 1, name: "public", isSystem: false }]);
  vi.mocked(ipc.metadataDropObject).mockResolvedValue(undefined);
  // Catalog order can put children before their parent.
  vi.mocked(ipc.metadataListObjects).mockResolvedValue([leaf, branch, parent, denied, table(20, "customers")]);
});
afterEach(() => { cleanup(); client.clear(); });

function mount(readOnly = false) {
  render(<QueryClientProvider client={client}><ObjectSidebar connectionId="connection" database="postgres" changingDatabase={false} readOnly={readOnly} onChangeDatabase={onChangeDatabase} onOpenObject={onOpenObject} /></QueryClientProvider>);
}

it("nests partitions, preserves table opening and collapses whole branches", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "public Tables" }));
  const expand = await screen.findByRole("button", { name: "orders 파티션" });
  expect(expand.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("button", { name: "orders_2026" })).toBeNull();
  expect(screen.getByRole("button", { name: "customers" })).toBeTruthy();
  fireEvent.doubleClick(screen.getByRole("button", { name: "orders" }));
  expect(onOpenObject).toHaveBeenLastCalledWith(parent);

  fireEvent.click(expand);
  expect(onOpenObject).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "restricted" }).getAttribute("aria-disabled")).toBe("true");
  expect(screen.queryByRole("button", { name: "archive.september" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "orders_2026 파티션" }));
  fireEvent.doubleClick(screen.getByRole("button", { name: "archive.september" }));
  expect(onOpenObject).toHaveBeenLastCalledWith(leaf);

  fireEvent.click(expand);
  expect(screen.queryByRole("button", { name: "orders_2026" })).toBeNull();
  expect(screen.queryByRole("button", { name: "archive.september" })).toBeNull();
});

it("deletes tables and routines from their context menu after confirmation", async () => {
  const routine = { ...table(30, "lookup"), kind: "function" as const, functionArguments: "integer", canSelect: null };
  vi.mocked(ipc.metadataListObjects).mockImplementation(async (req) => req.kinds.includes("function") ? [routine] : [parent]);
  const confirm = vi.mocked(confirmDialog).mockResolvedValue(true);
  mount();

  fireEvent.click(await screen.findByRole("button", { name: "public Tables" }));
  fireEvent.contextMenu(await screen.findByRole("button", { name: "orders" }), { clientX: 40, clientY: 60 });
  fireEvent.click(screen.getByRole("menuitem", { name: "삭제" }));
  await waitFor(() => expect(ipc.metadataDropObject).toHaveBeenCalledWith({ connectionId: "connection", objectOid: 10, kind: "table" }));

  fireEvent.click(screen.getByRole("button", { name: "public Functions" }));
  fireEvent.contextMenu(await screen.findByRole("button", { name: "lookup(integer)" }), { clientX: 40, clientY: 80 });
  fireEvent.click(screen.getByRole("menuitem", { name: "삭제" }));
  await waitFor(() => expect(ipc.metadataDropObject).toHaveBeenCalledWith({ connectionId: "connection", objectOid: 30, kind: "function" }));
  expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining("public.lookup(integer)"));
});

it("shows but disables deletion on read-only connections", async () => {
  mount(true);
  fireEvent.click(await screen.findByRole("button", { name: "public Tables" }));
  fireEvent.contextMenu(await screen.findByRole("button", { name: "orders" }));
  expect((screen.getByRole("menuitem", { name: "삭제 (읽기 전용)" }) as HTMLButtonElement).disabled).toBe(true);
  expect(ipc.metadataDropObject).not.toHaveBeenCalled();
});

it("searches collapsed partitions with their ancestors and restores the collapsed view", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "public Tables" }));
  await screen.findByRole("button", { name: "orders 파티션" });
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "SEPT" } });
  expect(screen.getByRole("button", { name: "orders" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "orders_2026" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "archive.september" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "customers" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "orders 파티션" }));
  expect(screen.queryByRole("button", { name: "archive.september" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "orders 파티션" }));
  expect(screen.getByRole("button", { name: "archive.september" })).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
  expect(screen.queryByRole("button", { name: "archive.september" })).toBeNull();
  expect(screen.getByRole("button", { name: "customers" })).toBeTruthy();
});

it("allows expanding a parent without SELECT permission", async () => {
  vi.mocked(ipc.metadataListObjects).mockResolvedValue([{ ...parent, canSelect: false }, branch]);
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "public Tables" }));
  fireEvent.click(await screen.findByRole("button", { name: "orders 파티션" }));
  expect(screen.getByRole("button", { name: "orders" }).getAttribute("aria-disabled")).toBe("true");
  fireEvent.doubleClick(screen.getByRole("button", { name: "orders_2026" }));
  expect(onOpenObject).toHaveBeenLastCalledWith(branch);
});

it("lists all databases and separates lazy table/function folders with overloaded signatures", async () => {
  vi.mocked(ipc.metadataListObjects).mockImplementation(async (req) => req.kinds.includes("function")
    ? ["integer", "text"].map((argument, i) => ({ ...table(30 + i, "lookup"), kind: "function", functionArguments: argument, canSelect: null }))
    : [parent, branch]);
  mount();
  const tables = await screen.findByRole("button", { name: "public Tables" });
  const functions = screen.getByRole("button", { name: "public Functions" });
  expect(tables.getAttribute("aria-expanded")).toBe("false");
  expect(functions.getAttribute("aria-expanded")).toBe("false");
  expect(ipc.metadataListObjects).not.toHaveBeenCalled();
  expect((screen.getByRole("option", { name: /template0/ }) as HTMLOptionElement).disabled).toBe(true);
  fireEvent.change(screen.getByRole("combobox", { name: "데이터베이스" }), { target: { value: "analytics" } });
  expect(onChangeDatabase).toHaveBeenCalledWith("analytics");

  fireEvent.click(functions);
  await screen.findByText("lookup(integer)");
  expect(screen.getByText("lookup(text)")).toBeTruthy();
  expect(ipc.metadataListObjects).toHaveBeenLastCalledWith({ connectionId: "connection", schemaOids: [1], kinds: ["function"] });
  fireEvent.click(screen.getByRole("button", { name: "lookup(integer)" }));
  expect(onOpenObject).toHaveBeenLastCalledWith(expect.objectContaining({ oid: 30, kind: "function", functionArguments: "integer" }));
  fireEvent.click(screen.getByRole("button", { name: "lookup(text)" }));
  expect(onOpenObject).toHaveBeenLastCalledWith(expect.objectContaining({ oid: 31, kind: "function", functionArguments: "text" }));
  fireEvent.click(tables);
  await screen.findByRole("button", { name: "orders" });
  expect(within(screen.getByRole("list", { name: "public Tables 목록" })).queryByText("lookup(integer)")).toBeNull();
  expect(within(screen.getByRole("list", { name: "public Functions 목록" })).queryByText("orders")).toBeNull();
  fireEvent.click(functions);
  expect(screen.queryByText("lookup(integer)")).toBeNull();
  expect(screen.getByRole("button", { name: "orders" })).toBeTruthy();
});

it("lists views in their own folder between tables and functions", async () => {
  const view = { ...table(40, "active_orders"), kind: "view" as const };
  const matview = { ...table(41, "order_totals"), kind: "materialized-view" as const };
  vi.mocked(ipc.metadataListObjects).mockImplementation(async (req) => req.kinds.includes("view") ? [view, matview] : [parent]);
  mount();
  const views = await screen.findByRole("button", { name: "public Views" });
  const folders = screen.getAllByRole("button", { name: /^public (Tables|Views|Functions)$/ }).map((b) => b.getAttribute("aria-label"));
  expect(folders).toEqual(["public Tables", "public Views", "public Functions"]);

  fireEvent.click(views);
  fireEvent.doubleClick(await screen.findByRole("button", { name: "active_orders" }));
  expect(onOpenObject).toHaveBeenLastCalledWith(view);
  expect(screen.getByRole("button", { name: "order_totals" })).toBeTruthy();
  expect(ipc.metadataListObjects).toHaveBeenLastCalledWith({ connectionId: "connection", schemaOids: [1], kinds: ["view", "materialized-view"] });

  fireEvent.click(screen.getByRole("button", { name: "public Tables" }));
  await screen.findByRole("button", { name: "orders" });
  expect(ipc.metadataListObjects).toHaveBeenLastCalledWith({ connectionId: "connection", schemaOids: [1], kinds: ["table"] });
  expect(within(screen.getByRole("list", { name: "public Tables 목록" })).queryByText("active_orders")).toBeNull();
});

it("walks rows with the arrow keys and opens the focused one with Enter", async () => {
  mount();
  const tree = screen.getByRole("tree");
  const tables = await screen.findByRole("button", { name: "public Tables" });
  fireEvent.click(tables);
  await screen.findByRole("button", { name: "customers" });

  // public → Tables → orders → customers, skipping the partition toggle.
  screen.getByRole("button", { name: "public" }).focus();
  for (const name of ["public Tables", "orders", "customers"]) {
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name }));
  }
  fireEvent.keyDown(tree, { key: "ArrowUp" });
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "orders" }));

  fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
  expect(screen.getByRole("button", { name: "orders_2026" })).toBeTruthy();
  fireEvent.keyDown(document.activeElement!, { key: "Enter" });
  expect(onOpenObject).toHaveBeenLastCalledWith(parent);
});

it("steps into children and back out to parents with the left and right arrows", async () => {
  mount();
  const schema = await screen.findByRole("button", { name: "public" });
  schema.focus();

  // Right on an open row moves inward; on a closed one it opens first.
  fireEvent.keyDown(schema, { key: "ArrowRight" });
  const tables = await screen.findByRole("button", { name: "public Tables" });
  expect(document.activeElement).toBe(tables);
  fireEvent.keyDown(tables, { key: "ArrowRight" });
  expect(tables.getAttribute("aria-expanded")).toBe("true");
  const orders = await screen.findByRole("button", { name: "orders" });
  fireEvent.keyDown(tables, { key: "ArrowRight" });
  expect(document.activeElement).toBe(orders);
  fireEvent.keyDown(orders, { key: "ArrowRight" });
  fireEvent.keyDown(orders, { key: "ArrowRight" });
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "orders_2026" }));

  // Left closes what is open, then walks back up one level at a time.
  fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
  expect(document.activeElement).toBe(orders);
  fireEvent.keyDown(orders, { key: "ArrowLeft" });
  expect(screen.queryByRole("button", { name: "orders_2026" })).toBeNull();
  fireEvent.keyDown(orders, { key: "ArrowLeft" });
  expect(document.activeElement).toBe(tables);
  fireEvent.keyDown(tables, { key: "ArrowLeft" });
  fireEvent.keyDown(tables, { key: "ArrowLeft" });
  expect(document.activeElement).toBe(schema);
  fireEvent.keyDown(schema, { key: "ArrowLeft" });
  fireEvent.keyDown(schema, { key: "ArrowLeft" });
  expect(document.activeElement).toBe(schema);
});

it("focuses the row that was clicked, including through its expand arrow", async () => {
  mount();
  const tables = await screen.findByRole("button", { name: "public Tables" });
  fireEvent.click(tables);
  expect(document.activeElement).toBe(tables);

  const orders = await screen.findByRole("button", { name: "orders" });
  fireEvent.click(orders);
  expect(document.activeElement).toBe(orders);

  fireEvent.click(screen.getByRole("button", { name: "orders 파티션" }));
  expect(document.activeElement).toBe(orders);
});

it("keeps a table without SELECT focusable but refuses to open it", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "public Tables" }));
  fireEvent.click(await screen.findByRole("button", { name: "orders 파티션" }));
  const restricted = screen.getByRole("button", { name: "restricted" });
  restricted.focus();
  expect(document.activeElement).toBe(restricted);
  fireEvent.keyDown(restricted, { key: "Enter" });
  fireEvent.doubleClick(restricted);
  expect(onOpenObject).not.toHaveBeenCalled();
});
