import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { ipc } from "../../shared/ipc/invoke";
import { fuzzyResult } from "./fuzzyMatch";
import { statementAt, stripLiterals } from "./statementSplitter";

type Catalog = { schema: string; name: string; oid: number; kind: string };
const catalogCache = new Map<string, Promise<Catalog[]>>();
const columnsCache = new Map<string, Promise<string[]>>();
type Words = { lower: Completion[]; upper: Completion[] };
const wordsCache = new Map<string, Promise<Words>>();

function unquote(value: string): string { return value.replace(/^"|"$/g, ""); }

/**
 * These caches never expire on their own, so a schema change stays invisible to
 * completion long after the object tree has caught up. Refresh empties them.
 */
export function clearCompletionCache(connectionId: string): void {
  for (const key of [...catalogCache.keys()]) if (key.startsWith(`${connectionId}:`)) catalogCache.delete(key);
  for (const key of [...columnsCache.keys()]) if (key.startsWith(`${connectionId}:`)) columnsCache.delete(key);
  for (const key of [...wordsCache.keys()]) if (key.startsWith(`${connectionId}:`)) wordsCache.delete(key);
}

async function catalog(connectionId: string, database: string): Promise<Catalog[]> {
  const key = `${connectionId}:${database}`;
  let pending = catalogCache.get(key);
  if (!pending) {
    pending = ipc.metadataListSchemas({ connectionId, includeSystem: false }).then(async (schemas) => {
      const objects = await ipc.metadataListObjects({ connectionId, schemaOids: schemas.map((s) => s.oid), kinds: ["table", "view", "materialized-view"] });
      return objects.map((o) => ({ schema: o.schema, name: o.name, oid: o.oid, kind: o.kind }));
    });
    catalogCache.set(key, pending);
  }
  return pending;
}

/**
 * The server's keywords, callable functions and types. The first entry of a word
 * wins, so a word that is both a keyword and a function (`left`) shows once.
 * boost -1 keeps them under an equally good column match.
 */
async function sqlWords(connectionId: string, database: string): Promise<Words> {
  const key = `${connectionId}:${database}`;
  let pending = wordsCache.get(key);
  if (!pending) {
    pending = ipc.metadataListSqlWords({ connectionId }).then(({ keywords, functions, types }) => {
      const seen = new Set<string>();
      const lower = [
        ...keywords.map((k) => ({ label: k.word, detail: k.category, type: "keyword" })),
        ...functions.map((label) => ({ label, detail: "function", type: "function" })),
        ...types.map((label) => ({ label, detail: "type", type: "type" })),
      ].filter((option) => !seen.has(option.label) && seen.add(option.label)).map((option) => ({ ...option, boost: -1 }));
      return { lower, upper: lower.map((option) => ({ ...option, label: option.label.toUpperCase() })) };
    });
    wordsCache.set(key, pending);
  }
  return pending;
}

function options(items: Array<{ label: string; detail?: string }>): Completion[] {
  return items.map((item) => ({ ...item, type: "variable" }));
}

/** Words that follow a table reference but are never its alias. */
const NOT_AN_ALIAS = "on|using|where|group|order|having|window|limit|offset|fetch|union|intersect|except|join|inner|outer|left|right|full|cross|natural|lateral|and|or|not|set|returning|for|into|select|from|as|values|with";
// The alias must not swallow the keyword that ends the reference, or the JOIN
// after a FROM would never be seen as a reference of its own.
// The trailing lookahead drops a half-typed "schema." — without it the schema
// being qualified is read as a bare table name, and a table that happens to
// share that name answers with its columns.
const REFERENCE = String.raw`\b(?:from|join)\s+(?:"?([\w$]+)"?\s*\.\s*)?"?([\w$]+)"?(?!\s*\.)(?:\s+(?:as\s+)?(?!(?:${NOT_AN_ALIAS})\b)"?([\w$]+)"?)?`;

type Reference = { table: Catalog; alias?: string };

/**
 * Tables named by FROM/JOIN in the statement, with their alias when they have
 * one. ponytail: direct references only; use scope parsing for CTE, derived
 * tables and comma-separated FROM items.
 */
function references(statementText: string, items: Catalog[]): Reference[] {
  return [...statementText.matchAll(new RegExp(REFERENCE, "gi"))].flatMap((match) => {
    const table = items.find((item) => item.name === unquote(match[2]) && (!match[1] || item.schema === unquote(match[1])));
    return table ? [{ table, alias: match[3] ? unquote(match[3]) : undefined }] : [];
  });
}

export function sqlCompletionSource(connectionId: string, database: string) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const doc = context.state.doc.toString();
    const current = statementAt(doc, context.pos);
    if (!current || context.pos < current.from || context.pos > current.to) return null;
    const statementFrom = current.from;
    const statementText = stripLiterals(context.state.sliceDoc(statementFrom, current.to));
    const before = statementText.slice(0, context.pos - statementFrom);
    const match = before.match(/((?:"?[\w$]+"?\.){1,2})"?[\w$]*$/);
    if (!match && !/[\w$]+$/.test(before) && !context.explicit) return null;
    const items = await catalog(connectionId, database);
    // A leading quote opens a quoted identifier; it is not part of the name typed.
    const result = (from: number, list: Completion[]) =>
      fuzzyResult(from, context.state.sliceDoc(from, context.pos).replace(/^"/, ""), list);
    if (match) {
      const parts = match[1].split(".").filter(Boolean).map(unquote);
      const from = context.pos - (match[0].length - match[1].length);
      if (parts.length === 1) {
        // A single qualifier is an alias or a referenced table before it is a schema.
        const qualifier = parts[0].toLowerCase();
        const referenced = references(statementText, items);
        const target = referenced.find((reference) => reference.alias?.toLowerCase() === qualifier)
          ?? referenced.find((reference) => !reference.alias && reference.table.name.toLowerCase() === qualifier);
        if (target) {
          const columns = await tableColumns(connectionId, database, target.table.oid);
          return result(from, options(columns.map((label) => ({ label, detail: "column" }))));
        }
        const tables = items.filter((item) => item.schema === parts[0]);
        return result(from, options(tables.map((item) => ({ label: item.name, detail: item.kind }))));
      }
      const table = items.find((item) => item.schema === parts[0] && item.name === parts[1]);
      if (!table) return null;
      const columns = await tableColumns(connectionId, database, table.oid);
      return result(from, options(columns.map((label) => ({ label, detail: "column" }))));
    }
    // FROM can follow the SELECT being edited, so inspect the whole statement.
    const referenced = references(statementText, items);
    const columns = (await Promise.all(referenced.map((reference) => tableColumns(connectionId, database, reference.table.oid)))).flat();
    const words = await sqlWords(connectionId, database);
    const from = context.matchBefore(/[\w$]*/)?.from ?? context.pos;
    const typed = context.state.sliceDoc(from, context.pos);
    // A quote opens an identifier, which a keyword never is, and whose name is
    // taken as written. Words follow the case being typed: `SEL` completes to
    // SELECT, `sel` to select.
    const wordOptions = context.state.sliceDoc(from - 1, from) === '"' ? []
      : /[A-Z]/.test(typed) && !/[a-z]/.test(typed) ? words.upper : words.lower;
    return result(from, [...options([...new Set(columns)].map((label) => ({ label, detail: "column" }))), ...wordOptions]);
  };
}

async function tableColumns(connectionId: string, database: string, oid: number): Promise<string[]> {
  const key = `${connectionId}:${database}:${oid}`;
  let pending = columnsCache.get(key);
  if (!pending) {
    pending = ipc.metadataGetTable({ connectionId, relationOid: oid }).then((meta) => meta.columns.map((column) => column.name));
    columnsCache.set(key, pending);
  }
  return pending;
}
