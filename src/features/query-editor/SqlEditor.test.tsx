// @vitest-environment jsdom
import { currentCompletions } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SqlEditor } from "./SqlEditor";

vi.mock("../../shared/ipc/invoke", () => ({ ipc: {
  metadataListSchemas: vi.fn(async () => [{ oid: 1, name: "cms" }, { oid: 2, name: "ext" }]),
  metadataListObjects: vi.fn(async () => [
    { oid: 10, schema: "cms", name: "fnn_fy_his", kind: "table" },
    { oid: 20, schema: "ext", name: "rpt_rcv_evnt", kind: "table" },
    // A table whose name collides with a schema, the case a bare "ext." hits.
    { oid: 30, schema: "cms", name: "ext", kind: "table" },
  ]),
  metadataGetTable: vi.fn(async ({ relationOid }: { relationOid: number }) => ({
    columns: (relationOid === 10 ? ["clsg_ym", "comp_cd", "stk_cd"]
      : relationOid === 30 ? ["ext_col"]
      : ["created_at", "rpt_std_dt"]).map((name) => ({ name })),
  })),
} }));

afterEach(cleanup);

it.each([
  "SELECT | FROM cms.fnn_fy_his;",
  "SELECT * FROM cms.fnn_fy_his WHERE |;",
  "SELECT * FROM cms.fnn_fy_his GROUP BY |;",
  "SELECT * FROM cms.fnn_fy_his ORDER BY |;",
  "SELECT * FROM ext.rpt_rcv_evnt; SELECT | FROM cms.fnn_fy_his; SELECT * FROM ext.rpt_rcv_evnt;",
  "SELECT 'from ext.rpt_rcv_evnt; literal', | FROM cms.fnn_fy_his /* join ext.rpt_rcv_evnt */;",
])("automatically suggests current-statement columns by prefix: %s", async (source) => {
  let view!: EditorView;
  const pos = source.indexOf("|");
  render(<SqlEditor initialSql={source.replace("|", "")} connectionId="completion" database="postgres"
    onViewReady={(next) => { if (next) view = next; }} />);
  view.dispatch({ changes: { from: pos, insert: "c" }, selection: { anchor: pos + 1 }, userEvent: "input.type" });
  const labels = () => currentCompletions(view.state).map((option) => option.label).sort();
  await waitFor(() => expect(labels()).toEqual(["clsg_ym", "comp_cd"]));
  view.dispatch({ changes: { from: pos + 1, insert: "o" }, selection: { anchor: pos + 2 }, userEvent: "input.type" });
  await waitFor(() => expect(labels()).toEqual(["comp_cd"]));
  view.dispatch({ changes: { from: pos + 1, to: pos + 2 }, selection: { anchor: pos + 1 }, userEvent: "delete.backward" });
  await waitFor(() => expect(labels()).toEqual(["clsg_ym", "comp_cd"]));
  view.dispatch({ changes: { from: pos + 1, insert: "p" }, selection: { anchor: pos + 2 }, userEvent: "input.type" });
  expect(labels()).toEqual([]); // "cp" must not fuzzy-match "comp_cd".
});

it.each([
  ["SELECT | FROM cms.fnn_fy_his JOIN ext.rpt_rcv_evnt ON true;", "c", ["clsg_ym", "comp_cd", "created_at"]],
  ["SELECT * FROM cms.fnn_fy_his WHERE |;", "C", ["clsg_ym", "comp_cd"]],
  ["SELECT * FROM cms|", ".", ["ext", "fnn_fy_his"]],
  ["SELECT cms.fnn_fy_his| FROM cms.fnn_fy_his;", ".", ["clsg_ym", "comp_cd", "stk_cd"]],
  // An alias resolves to its own table, from either side of the statement.
  ["SELECT f| FROM cms.fnn_fy_his f;", ".", ["clsg_ym", "comp_cd", "stk_cd"]],
  ["SELECT * FROM cms.fnn_fy_his AS f WHERE f|;", ".", ["clsg_ym", "comp_cd", "stk_cd"]],
  ["SELECT * FROM cms.fnn_fy_his f JOIN ext.rpt_rcv_evnt r ON r|;", ".", ["created_at", "rpt_std_dt"]],
  ["SELECT * FROM cms.fnn_fy_his f JOIN ext.rpt_rcv_evnt r ON f|;", ".", ["clsg_ym", "comp_cd", "stk_cd"]],
  // An unaliased table answers to its own name, and a schema still lists tables.
  ["SELECT * FROM cms.fnn_fy_his WHERE fnn_fy_his|;", ".", ["clsg_ym", "comp_cd", "stk_cd"]],
  ["SELECT * FROM cms.fnn_fy_his WHERE ext|;", ".", ["rpt_rcv_evnt"]],
  // WHERE is a keyword, never the alias of the table before it.
  ["SELECT * FROM cms.fnn_fy_his WHERE where|;", ".", []],
  // The schema being typed is not itself a table reference, even when a table
  // of that name exists: "FROM ext." lists ext's tables, not fnn_fy_his's columns.
  ["SELECT * FROM ext|", ".", ["rpt_rcv_evnt"]],
  ["SELECT * FROM cms.fnn_fy_his JOIN ext|", ".", ["rpt_rcv_evnt"]],
  // Once the reference is complete, the same word answers for the table again.
  ["SELECT * FROM cms.ext WHERE ext|;", ".", ["ext_col"]],
] as const)("supports JOIN columns, case-insensitive prefixes and dot completion: %s", async (source, insert, expected) => {
  let view!: EditorView;
  const pos = source.indexOf("|");
  render(<SqlEditor initialSql={source.replace("|", "")} connectionId="completion" database="postgres"
    onViewReady={(next) => { if (next) view = next; }} />);
  view.dispatch({ changes: { from: pos, insert }, selection: { anchor: pos + insert.length }, userEvent: "input.type" });
  await waitFor(() => expect(currentCompletions(view.state).map((option) => option.label).sort()).toEqual(expected));
});

it.each([true, false])("highlights routine bodies without treating dollar-quoted values as code (readOnly=%s)", (readOnly) => {
  const source = `CREATE OR REPLACE PROCEDURE cms.example() LANGUAGE plpgsql AS $procedure$
DECLARE
  v_reg_id TEXT := 'batch-1st';
BEGIN
  -- 결산 정보
  IF true THEN
    DELETE FROM cms.fnn_fy_his;
    EXECUTE $sql$SELECT 'dynamic query';$sql$;
  END IF;
END
$procedure$;
SELECT $$literal value$$;`;
  let view!: EditorView;
  render(<SqlEditor initialSql={source} readOnly={readOnly} onViewReady={(v) => { if (v) view = v; }} />);
  const spans = Array.from(view.contentDOM.querySelectorAll("span"));
  const token = (text: string) => spans.find((span) => span.textContent === text);
  const keywordClass = token("CREATE")!.className;
  for (const keyword of ["DECLARE", "BEGIN", "IF", "DELETE", "END"]) {
    expect(token(keyword)?.className, keyword).toBe(keywordClass);
  }
  expect(token("-- 결산 정보")?.className).toBeTruthy();
  expect(token("-- 결산 정보")?.className).not.toBe(keywordClass);
  const stringClass = token("'batch-1st'")!.className;
  expect(stringClass).not.toBe(keywordClass);
  expect(token("$sql$SELECT 'dynamic query';$sql$")?.className).toBe(stringClass);
  expect(token("$$literal value$$")?.className).toBe(stringClass);
  expect(view.state.doc.toString()).toBe(source);
});

it.each([
  ["CREATE FUNCTION f() RETURNS int AS $$SELECT 1;$$ LANGUAGE sql;", true],
  ["CREATE FUNCTION f() RETURNS int LANGUAGE 'sql' AS /* body */ $fn$SELECT 1;$fn$;", true],
  ["DO $$BEGIN SELECT 1; END$$;", true],
  ["CREATE FUNCTION f() RETURNS text AS $fn$SELECT literal text$fn$ LANGUAGE plpython3u;", false],
])("handles routine language and delimiter variants: %s", (source, highlighted) => {
  let view!: EditorView;
  render(<SqlEditor initialSql={source} readOnly onViewReady={(v) => { if (v) view = v; }} />);
  const spans = Array.from(view.contentDOM.querySelectorAll("span"));
  const keywordClass = spans.find((span) => span.textContent === "CREATE" || span.textContent === "DO")!.className;
  expect(spans.some((span) => span.textContent === "SELECT" && span.className === keywordClass)).toBe(highlighted);
  expect(view.state.doc.toString()).toBe(source);
});

it("makes definitions selectable but read-only and disables SQL execution shortcuts", () => {
  let view!: EditorView;
  const run = vi.fn();
  render(<SqlEditor initialSql="SELECT 1;" readOnly onRun={run} onRunNewResult={run} onViewReady={(v) => { if (v) view = v; }} />);
  const content = screen.getByLabelText("정의 SQL");
  expect(view.state.readOnly).toBe(true);
  expect(content.getAttribute("contenteditable")).toBe("false");
  expect(content.getAttribute("tabindex")).toBe("0");
  view.dispatch({ selection: { anchor: 0, head: 6 } });
  expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("SELECT");
  fireEvent.keyDown(content, { key: "Enter", code: "Enter", ctrlKey: true });
  fireEvent.keyDown(content, { key: "Enter", code: "Enter", metaKey: true, shiftKey: true });
  expect(run).not.toHaveBeenCalled();
  expect(view.state.doc.toString()).toBe("SELECT 1;");
});

it("uses Tab and Shift+Tab for editor indentation without moving focus", () => {
  let view!: EditorView;
  render(<SqlEditor initialSql="SELECT 1;" onViewReady={(next) => { if (next) view = next; }} />);
  const content = screen.getByLabelText("SQL 편집기");
  content.focus();
  fireEvent.keyDown(content, { key: "Tab", code: "Tab" });
  expect(view.state.doc.toString()).toMatch(/^\s+SELECT 1;$/);
  expect(document.activeElement).toBe(content);
  fireEvent.keyDown(content, { key: "Tab", code: "Tab", shiftKey: true });
  expect(view.state.doc.toString()).toBe("SELECT 1;");
});
