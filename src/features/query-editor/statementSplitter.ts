export type Statement = { sql: string; from: number; to: number };

/**
 * Splits SQL into statements on top-level semicolons, honoring single/double
 * quotes (with '' escaping), dollar-quoted strings, line comments and nested
 * block comments. Boundary detection only — not a SQL parser.
 */
export function splitStatements(sql: string): Statement[] {
  const statements: Statement[] = [];
  let start = 0;
  let i = 0;
  const n = sql.length;

  const push = (end: number) => {
    const raw = sql.slice(start, end);
    if (raw.trim().length > 0) statements.push({ sql: raw.trim(), from: start, to: end });
    start = end + 1;
  };

  while (i < n) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      const quote = c;
      i++;
      while (i < n) {
        if (sql[i] === quote) {
          if (quote === "'" && sql[i + 1] === "'") {
            i += 2; // escaped ''
            continue;
          }
          break;
        }
        i++;
      }
      i++;
    } else if (c === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? n : nl + 1;
    } else if (c === "/" && sql[i + 1] === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
    } else if (c === "$") {
      // dollar quote: $tag$ ... $tag$
      const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const close = sql.indexOf(tag, i + tag.length);
        i = close === -1 ? n : close + tag.length;
      } else {
        i++;
      }
    } else if (c === ";") {
      push(i);
      i++;
    } else {
      i++;
    }
  }
  push(n);
  return statements;
}

/**
 * Replaces string literals, dollar-quoted bodies and comments with spaces so
 * keyword scans (editability gate) can't be fooled by literal content.
 */
export function stripLiterals(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  const blank = (from: number, to: number) => {
    out += sql.slice(from, to).replace(/[^\n]/g, " ");
  };
  while (i < n) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      const start = i;
      const quote = c;
      i++;
      while (i < n) {
        if (sql[i] === quote) {
          if (quote === "'" && sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          break;
        }
        i++;
      }
      i++;
      if (quote === '"') out += sql.slice(start, Math.min(i, n));
      else blank(start, Math.min(i, n));
    } else if (c === "-" && sql[i + 1] === "-") {
      const start = i;
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? n : nl;
      blank(start, i);
    } else if (c === "/" && sql[i + 1] === "*") {
      const start = i;
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          i += 2;
        } else i++;
      }
      blank(start, i);
    } else if (c === "$") {
      const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
      if (m) {
        const start = i;
        const tag = m[0];
        const close = sql.indexOf(tag, i + tag.length);
        i = close === -1 ? n : close + tag.length;
        blank(start, i);
      } else {
        out += c;
        i++;
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** The statement containing the cursor, or the last one before it. */
export function statementAt(sql: string, cursor: number): Statement | undefined {
  const statements = splitStatements(sql);
  return (
    statements.find((s) => cursor >= s.from && cursor <= s.to + 1) ??
    statements.filter((s) => s.to < cursor).pop() ??
    statements[0]
  );
}
