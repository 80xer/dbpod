import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { ipc } from "../../shared/ipc/invoke";
import { statementAt } from "./statementSplitter";

type Catalog = { schema: string; name: string; oid: number; kind: string };
const catalogCache = new Map<string, Promise<Catalog[]>>();
const columnsCache = new Map<string, Promise<string[]>>();

function unquote(value: string): string { return value.replace(/^"|"$/g, ""); }

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

function options(items: Array<{ label: string; detail?: string }>): Completion[] {
  return items.map((item) => ({ ...item, type: "variable" }));
}

export function sqlCompletionSource(connectionId: string, database: string) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const doc = context.state.doc.toString();
    const current = statementAt(doc, context.pos);
    if (!current) return null;
    const statementFrom = current.from;
    const statementText = context.state.sliceDoc(statementFrom, current.to);
    const before = statementText.slice(0, context.pos - statementFrom);
    const match = before.match(/((?:"?[\w$]+"?\.){1,2})"?[\w$]*$/);
    const items = await catalog(connectionId, database);
    if (match) {
      const parts = match[1].split(".").filter(Boolean).map(unquote);
      const from = context.pos - (match[0].length - match[1].length);
      if (parts.length === 1) {
        const tables = items.filter((item) => item.schema === parts[0]);
        return { from, options: options(tables.map((item) => ({ label: item.name, detail: item.kind }))), validFor: /^[\w$]*$/ };
      }
      const table = items.find((item) => item.schema === parts[0] && item.name === parts[1]);
      if (!table) return null;
      const columns = await tableColumns(connectionId, database, table.oid);
      return { from, options: options(columns.map((label) => ({ label, detail: "column" }))), validFor: /^[\w$]*$/ };
    }
    const referenced = [...before.matchAll(/(?:from|join)\s+(?:"?([\w$]+)"?\.)?"?([\w$]+)"?/gi)]
      .map((m) => items.find((item) => item.name === unquote(m[2]) && (!m[1] || item.schema === unquote(m[1]))))
      .filter((item): item is Catalog => Boolean(item));
    if (!referenced.length) return null;
    const columns = (await Promise.all(referenced.map((table) => tableColumns(connectionId, database, table.oid)))).flat();
    const word = context.matchBefore(/[\w$]*/);
    return { from: word?.from ?? context.pos, options: options([...new Set(columns)].map((label) => ({ label, detail: "column" }))), validFor: /^[\w$]*$/ };
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
