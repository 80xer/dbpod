import type { EditorView } from "@codemirror/view";
import { format } from "sql-formatter";

import { statementAt } from "./statementSplitter";

/** The range to reformat: the selection when there is one, else the statement at the cursor. */
export function formatRange(doc: string, from: number, to: number): { from: number; to: number } | null {
  const bounds = from !== to ? { from, to } : statementAt(doc, from);
  if (!bounds) return null;
  // statementAt keeps the separator and surrounding blank lines in its bounds;
  // reformatting those away would glue the statement to the previous one.
  const raw = doc.slice(bounds.from, bounds.to);
  const start = bounds.from + (raw.length - raw.trimStart().length);
  const end = start + raw.trim().length;
  return end > start ? { from: start, to: end } : null;
}

export function formatSqlInEditor(view: EditorView): boolean {
  const doc = view.state.doc.toString();
  const { from, to } = view.state.selection.main;
  const range = formatRange(doc, from, to);
  if (!range) return false;
  const original = doc.slice(range.from, range.to);
  let formatted: string;
  try {
    formatted = format(original, { language: "postgresql", keywordCase: "lower", tabWidth: 2 });
  } catch {
    // Unparseable SQL is left exactly as typed; the editor is not a linter.
    return false;
  }
  if (formatted === original) return false;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: formatted },
    selection: { anchor: range.from + formatted.length },
    scrollIntoView: true,
  });
  return true;
}
