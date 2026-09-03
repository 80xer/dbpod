import { describe, expect, it } from "vitest";
import { splitStatements, statementAt } from "./statementSplitter";

describe("splitStatements", () => {
  it("splits on top-level semicolons", () => {
    const r = splitStatements("select 1; select 2;");
    expect(r.map((s) => s.sql)).toEqual(["select 1", "select 2"]);
  });

  it("ignores semicolons inside single quotes with '' escape", () => {
    const r = splitStatements("select 'a;''b;c'; select 2");
    expect(r.map((s) => s.sql)).toEqual(["select 'a;''b;c'", "select 2"]);
  });

  it("ignores semicolons inside double-quoted identifiers", () => {
    const r = splitStatements('select ";" as "a;b"; select 2');
    expect(r).toHaveLength(2);
  });

  it("ignores semicolons in line comments", () => {
    const r = splitStatements("select 1 -- comment; not a boundary\n; select 2");
    expect(r.map((s) => s.sql.startsWith("select"))).toEqual([true, true]);
    expect(r).toHaveLength(2);
  });

  it("handles nested block comments", () => {
    const r = splitStatements("select 1 /* outer /* inner; */ still; */; select 2");
    expect(r).toHaveLength(2);
  });

  it("handles dollar-quoted bodies", () => {
    const sql = "create function f() returns int as $fn$ begin return 1; end $fn$ language plpgsql; select 2";
    const r = splitStatements(sql);
    expect(r).toHaveLength(2);
  });

  it("handles anonymous dollar quotes", () => {
    const r = splitStatements("select $$a;b$$; select 2");
    expect(r).toHaveLength(2);
  });

  it("drops empty statements", () => {
    const r = splitStatements(";;  ;select 1;");
    expect(r.map((s) => s.sql)).toEqual(["select 1"]);
  });

  it("unterminated quote consumes to end without crashing", () => {
    const r = splitStatements("select 'oops; select 2");
    expect(r).toHaveLength(1);
  });
});

describe("statementAt", () => {
  const sql = "select 1;\nselect 2;\nselect 3";

  it("returns the statement under the cursor", () => {
    expect(statementAt(sql, sql.indexOf("2"))?.sql).toBe("select 2");
  });

  it("returns the first statement at position 0", () => {
    expect(statementAt(sql, 0)?.sql).toBe("select 1");
  });

  it("returns the last statement at the end", () => {
    expect(statementAt(sql, sql.length)?.sql).toBe("select 3");
  });

  it("returns undefined-safe result for empty input", () => {
    expect(statementAt("", 0)).toBeUndefined();
  });
});
