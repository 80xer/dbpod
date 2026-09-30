// @vitest-environment jsdom
import { closeCompletion, completionStatus, currentCompletions } from "@codemirror/autocomplete";
import { runScopeHandlers, type EditorView } from "@codemirror/view";
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
  metadataListSqlWords: vi.fn(async () => ({
    keywords: [["case", "reserved"], ["left", "reserved (can be function or type)"], ["select", "reserved"], ["when", "reserved"], ["where", "reserved"]]
      .map(([word, category]) => ({ word, category })),
    functions: ["left", "string_agg", "string_to_array"],
    types: ["json", "jsonb"],
  })),
} }));

afterEach(cleanup);

/** Column suggestions only: keywords match most letters too, and are covered on their own. */
const columnLabels = (view: EditorView) =>
  currentCompletions(view.state).filter((option) => option.detail === "column").map((option) => option.label);

it.each([
  "SELECT | FROM cms.fnn_fy_his;",
  "SELECT * FROM cms.fnn_fy_his WHERE |;",
  "SELECT * FROM cms.fnn_fy_his GROUP BY |;",
  "SELECT * FROM cms.fnn_fy_his ORDER BY |;",
  "SELECT * FROM ext.rpt_rcv_evnt; SELECT | FROM cms.fnn_fy_his; SELECT * FROM ext.rpt_rcv_evnt;",
  "SELECT 'from ext.rpt_rcv_evnt; literal', | FROM cms.fnn_fy_his /* join ext.rpt_rcv_evnt */;",
])("automatically suggests current-statement columns as letters are typed: %s", async (source) => {
  let view!: EditorView;
  const pos = source.indexOf("|");
  render(<SqlEditor initialSql={source.replace("|", "")} connectionId="completion" database="postgres"
    onViewReady={(next) => { if (next) view = next; }} />);
  view.dispatch({ changes: { from: pos, insert: "c" }, selection: { anchor: pos + 1 }, userEvent: "input.type" });
  const labels = () => columnLabels(view).sort();
  // stk_cd has its c past the start, and still answers a single typed c.
  await waitFor(() => expect(labels()).toEqual(["clsg_ym", "comp_cd", "stk_cd"]));
  view.dispatch({ changes: { from: pos + 1, insert: "o" }, selection: { anchor: pos + 2 }, userEvent: "input.type" });
  await waitFor(() => expect(labels()).toEqual(["comp_cd"]));
  view.dispatch({ changes: { from: pos + 1, to: pos + 2 }, selection: { anchor: pos + 1 }, userEvent: "delete.backward" });
  await waitFor(() => expect(labels()).toEqual(["clsg_ym", "comp_cd", "stk_cd"]));
  view.dispatch({ changes: { from: pos + 1, insert: "p" }, selection: { anchor: pos + 2 }, userEvent: "input.type" });
  // Two scattered letters match too, as in VS Code's Cmd+P.
  await waitFor(() => expect(labels()).toEqual(["comp_cd"]));
});

it.each([
  // Letters the name has in order, scattered: the ordinary way a half-remembered
  // column gets typed.
  ["cym", ["clsg_ym"]],
  ["cpc", ["comp_cd"]],
  // The initials of the underscore-joined parts.
  ["scd", ["stk_cd"]],
  // Nothing has to match the name's first letter, not even a single typed one.
  ["y", ["clsg_ym"]],
  ["mc", ["comp_cd"]],
  // Letters the name does not have, or has out of order, still match nothing.
  ["czz", []],
  ["dc", []],
] as const)("completes columns on scattered letters, not only on a prefix: %s", async (typed, expected) => {
  let view!: EditorView;
  const source = "SELECT  FROM cms.fnn_fy_his;";
  const pos = source.indexOf(" FROM");
  render(<SqlEditor initialSql={source} connectionId="completion" database="postgres"
    onViewReady={(next) => { if (next) view = next; }} />);
  view.dispatch({ changes: { from: pos, insert: typed }, selection: { anchor: pos + typed.length }, userEvent: "input.type" });
  await waitFor(() => expect(columnLabels(view).sort()).toEqual([...expected]));
});

it.each([
  ["s", ["stk_cd", "clsg_ym"]],
  ["cd", ["comp_cd", "stk_cd"]],
] as const)("lists the name whose match starts earliest first: %s", async (typed, expected) => {
  let view!: EditorView;
  const source = "SELECT  FROM cms.fnn_fy_his;";
  const pos = source.indexOf(" FROM");
  render(<SqlEditor initialSql={source} connectionId="completion" database="postgres"
    onViewReady={(next) => { if (next) view = next; }} />);
  view.dispatch({ changes: { from: pos, insert: typed }, selection: { anchor: pos + typed.length }, userEvent: "input.type" });
  await waitFor(() => expect(columnLabels(view)).toEqual([...expected]));
});

it("accepts the selected completion with Tab, and indents when no list is open", async () => {
  let view!: EditorView;
  const source = "SELECT * FROM cms.";
  render(<SqlEditor initialSql={source} connectionId="completion" database="postgres"
    onViewReady={(next) => { if (next) view = next; }} />);
  const tab = () => runScopeHandlers(view, new KeyboardEvent("keydown", { key: "Tab", code: "Tab", keyCode: 9 }), "editor");
  view.dispatch({ changes: { from: source.length, insert: "ffh" }, selection: { anchor: source.length + 3 }, userEvent: "input.type" });
  await waitFor(() => expect(currentCompletions(view.state).map((option) => option.label)).toEqual(["fnn_fy_his"]));
  // CodeMirror ignores an accept that lands right as the list opens; step past that delay.
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now + 1000);
  try {
    expect(tab()).toBe(true);
  } finally {
    clock.mockRestore();
  }
  expect(view.state.doc.toString()).toBe("SELECT * FROM cms.fnn_fy_his");

  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "" }, selection: { anchor: 0 } });
  expect(tab()).toBe(true);
  expect(view.state.doc.toString()).not.toBe("");
});

it("opens completion on the word under the cursor with Mod+Period, without typing", async () => {
  let view!: EditorView;
  const source = "SELECT * FROM cms.fh";
  render(<SqlEditor initialSql={source} connectionId="completion" database="postgres"
    onViewReady={(next) => { if (next) view = next; }} />);
  view.dispatch({ selection: { anchor: source.length } });
  expect(currentCompletions(view.state)).toEqual([]);
  // jsdom is not a Mac, so Mod is Ctrl here.
  expect(runScopeHandlers(view, new KeyboardEvent("keydown", { key: ".", code: "Period", ctrlKey: true }), "editor")).toBe(true);
  await waitFor(() => expect(currentCompletions(view.state).map((option) => option.label)).toEqual(["fnn_fy_his"]));
});

it("opens completion when a deletion leaves the cursor on a name, not in whitespace", async () => {
  let view!: EditorView;
  const source = "SELECT * FROM cms.ffhx";
  render(<SqlEditor initialSql={source} connectionId="completion" database="postgres"
    onViewReady={(next) => { if (next) view = next; }} />);
  const backspace = () => {
    const head = view.state.selection.main.head;
    view.dispatch({ changes: { from: head - 1, to: head }, selection: { anchor: head - 1 }, userEvent: "delete.backward" });
  };
  view.dispatch({ selection: { anchor: source.length } });
  expect(completionStatus(view.state)).toBeNull();
  backspace();
  await waitFor(() => expect(currentCompletions(view.state).map((option) => option.label)).toEqual(["fnn_fy_his"]));

  closeCompletion(view);
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "SELECT * x" }, selection: { anchor: 10 } });
  backspace();
  // The reopen is queued as a microtask, so one flush is enough to see it would have fired.
  await Promise.resolve();
  expect(completionStatus(view.state)).toBeNull();
});

it("completes a table on the initials of its underscore-joined parts", async () => {
  let view!: EditorView;
  const source = "SELECT * FROM cms.";
  render(<SqlEditor initialSql={source} connectionId="completion" database="postgres"
    onViewReady={(next) => { if (next) view = next; }} />);
  view.dispatch({ changes: { from: source.length, insert: "ffh" }, selection: { anchor: source.length + 3 }, userEvent: "input.type" });
  await waitFor(() => expect(currentCompletions(view.state).map((option) => option.label)).toEqual(["fnn_fy_his"]));
});

it.each([
  ["SELECT | FROM cms.fnn_fy_his JOIN ext.rpt_rcv_evnt ON true;", "c", ["clsg_ym", "comp_cd", "created_at", "stk_cd"]],
  ["SELECT * FROM cms.fnn_fy_his WHERE |;", "C", ["clsg_ym", "comp_cd", "stk_cd"]],
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
  // Dot completion lists only the qualified names; typed letters also list keywords.
  const labels = () => (insert === "." ? currentCompletions(view.state).map((option) => option.label) : columnLabels(view)).sort();
  await waitFor(() => expect(labels()).toEqual(expected));
});

it.each([
  ["", "sel", "select", "reserved"],
  ["", "SEL", "SELECT", "reserved"],
  ["SELECT * FROM cms.fnn_fy_his ", "wher", "where", "reserved"],
  ["SELECT ", "string_to", "string_to_array", "function"],
  ["SELECT ", "STRING_TO", "STRING_TO_ARRAY", "function"],
  ["SELECT id::", "jso", "json", "type"],
] as const)("completes the server's keywords, functions and types in the typed case: %s%s", async (source, typed, first, detail) => {
  let view!: EditorView;
  render(<SqlEditor initialSql={source} connectionId="completion" database="postgres"
    onViewReady={(next) => { if (next) view = next; }} />);
  view.dispatch({ changes: { from: source.length, insert: typed }, selection: { anchor: source.length + typed.length }, userEvent: "input.type" });
  await waitFor(() => expect(currentCompletions(view.state)[0]).toMatchObject({ label: first, detail }));
});

it("lists a word that is both a keyword and a function once", async () => {
  let view!: EditorView;
  render(<SqlEditor initialSql="SELECT " connectionId="completion" database="postgres"
    onViewReady={(next) => { if (next) view = next; }} />);
  view.dispatch({ changes: { from: 7, insert: "lef" }, selection: { anchor: 10 }, userEvent: "input.type" });
  await waitFor(() => expect(currentCompletions(view.state).filter((option) => option.label === "left")).toHaveLength(1));
});

it("lists a column before a keyword that matches it equally well, and no keyword inside quotes", async () => {
  let view!: EditorView;
  const source = "SELECT * FROM cms.fnn_fy_his WHERE ";
  render(<SqlEditor initialSql={source} connectionId="completion" database="postgres"
    onViewReady={(next) => { if (next) view = next; }} />);
  view.dispatch({ changes: { from: source.length, insert: "c" }, selection: { anchor: source.length + 1 }, userEvent: "input.type" });
  // clsg_ym and case both match c at their first letter; the column goes first.
  await waitFor(() => expect(currentCompletions(view.state).slice(0, 2).map((option) => option.detail)).toEqual(["column", "column"]));
  expect(currentCompletions(view.state).map((option) => option.label)).toContain("case");
  view.dispatch({ changes: { from: source.length, to: source.length + 1, insert: '"c' }, selection: { anchor: source.length + 2 }, userEvent: "input.type" });
  await waitFor(() => expect(currentCompletions(view.state).map((option) => option.detail)).toEqual(["column", "column", "column"]));
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

it("adds the next occurrence as another cursor on Cmd+Shift+D, and typing edits every cursor", () => {
  let view!: EditorView;
  render(<SqlEditor initialSql="SELECT id, id FROM t WHERE id = 1;" onViewReady={(next) => { if (next) view = next; }} />);
  const content = screen.getByLabelText("SQL 편집기");
  content.focus();
  view.dispatch({ selection: { anchor: 7, head: 9 } });
  // Shift+letter arrives as the upper-case key plus the base keyCode, which is how
  // CodeMirror tells "Mod-Shift-d" apart from the inert "Mod-d" underneath it.
  const addNext = () => fireEvent.keyDown(content, { key: "D", code: "KeyD", keyCode: 68, ctrlKey: true, shiftKey: true });
  addNext();
  expect(view.state.selection.ranges.map((r) => view.state.sliceDoc(r.from, r.to))).toEqual(["id", "id"]);
  addNext();
  expect(view.state.selection.ranges).toHaveLength(3);
  view.dispatch(view.state.replaceSelection("pk"));
  expect(view.state.doc.toString()).toBe("SELECT pk, pk FROM t WHERE pk = 1;");
  expect(view.state.selection.ranges).toHaveLength(3);
});

it("renders the completion list outside the editor, which clips its overflow", async () => {
  let view!: EditorView;
  const source = "SELECT  FROM cms.fnn_fy_his;";
  const pos = source.indexOf("SELECT ") + 7;
  const { container } = render(<SqlEditor initialSql={source} connectionId="completion" database="postgres"
    onViewReady={(next) => { if (next) view = next; }} />);
  view.dispatch({ changes: { from: pos, insert: "c" }, selection: { anchor: pos + 1 }, userEvent: "input.type" });
  await waitFor(() => expect(currentCompletions(view.state).length).toBeGreaterThan(0));
  const tooltip = await waitFor(() => {
    const element = document.querySelector(".cm-tooltip-autocomplete");
    expect(element).toBeTruthy();
    return element!;
  });
  expect(container.contains(tooltip)).toBe(false);
  expect(tooltip.closest("body")).toBeTruthy();
});
