// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { TableColumnMetadata, TableMetadata } from "../../generated/ipc-types";
import { TablePropertiesView } from "./TablePropertiesView";

vi.mock("../../shared/ipc/invoke", () => ({ ipc: {} }));
afterEach(cleanup);

const column = (attributeNumber: number, name: string, pgTypeName: string): TableColumnMetadata => ({
  attributeNumber, name, pgTypeOid: 0, pgTypeName, nullable: true, defaultExpr: null, comment: null, isGenerated: false, isPrimaryKey: false,
});

test("header clicks alternate ascending and descending sorts and # restores catalog order", () => {
  const meta = {
    relationOid: 1, schema: "public", name: "t", kind: "table",
    columns: [column(1, "b_col10", "text"), column(2, "a_col", "int4"), column(3, "b_col9", "text")],
  } as unknown as TableMetadata;
  render(<QueryClientProvider client={new QueryClient()}>
    <TablePropertiesView connectionId="c" target={{} as never} meta={meta} section="columns" onSectionChange={() => {}} />
  </QueryClientProvider>);
  const table = screen.getByRole("table", { name: "컬럼" });
  const order = () => within(table).getAllByRole("row").slice(1).map((row) => row.firstElementChild!.textContent);
  const header = (name: RegExp) => within(table).getByRole("button", { name });

  fireEvent.click(header(/^column name/));
  expect(order()).toEqual(["2", "3", "1"]); // numeric-aware: col9 before col10
  expect(header(/^column name/).closest("th")!.getAttribute("aria-sort")).toBe("ascending");
  fireEvent.click(header(/^column name/));
  expect(order()).toEqual(["1", "3", "2"]);
  fireEvent.click(header(/^column name/));
  expect(order()).toEqual(["2", "3", "1"]);

  // A new column starts ascending; ties keep catalog order.
  fireEvent.click(header(/^data type/));
  expect(order()).toEqual(["2", "1", "3"]);
  expect(header(/^column name/).closest("th")!.getAttribute("aria-sort")).toBeNull();
  fireEvent.click(header(/^data type/));
  expect(order()).toEqual(["1", "3", "2"]);

  fireEvent.click(header(/^#$/));
  expect(order()).toEqual(["1", "2", "3"]);
  expect(within(table).queryByText(/[▲▼]/)).toBeNull();

  // A clicked row stays selected, alone, and follows its column through a re-sort.
  const row = (name: string) => within(table).getByText(name).closest("tr")!;
  fireEvent.click(row("a_col"));
  fireEvent.click(row("b_col9"));
  expect(within(table).getAllByRole("row").filter((r) => r.getAttribute("aria-selected") === "true")).toEqual([row("b_col9")]);
  fireEvent.click(header(/^column name/));
  expect(row("b_col9").getAttribute("aria-selected")).toBe("true");
  expect(row("b_col9").className).toContain("bg-blue-100");
});
