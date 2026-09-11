// @vitest-environment jsdom
import type { EditorView } from "@codemirror/view";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SqlEditor } from "./SqlEditor";

afterEach(cleanup);

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
