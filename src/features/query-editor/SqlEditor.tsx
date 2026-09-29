import { PostgreSQL, sql } from "@codemirror/lang-sql";
import { autocompletion } from "@codemirror/autocomplete";
import { indentWithTab } from "@codemirror/commands";
import { findNext, findPrevious, gotoLine, openSearchPanel, search, selectNextOccurrence, selectSelectionMatches } from "@codemirror/search";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, tooltips, type Command, type KeyBinding } from "@codemirror/view";
import { parseMixed, type SyntaxNode } from "@lezer/common";
import { tags } from "@lezer/highlight";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";
import { getAppSettings } from "../../entities/settings/appSettings";
import { shortcutToCodeMirror } from "../../entities/settings/shortcuts";
import { formatSqlInEditor } from "./formatSql";
import { sqlCompletionSource } from "./sqlCompletion";

/** One keymap entry, or none when the user has cleared that shortcut. */
function bind(shortcut: string, run: Command): KeyBinding[] {
  const key = shortcutToCodeMirror(shortcut);
  return key ? [{ key, run }] : [];
}

const postgresWithRoutineBodies = PostgreSQL.configureLanguage({
  wrap: parseMixed((node, input) => {
    if (node.name !== "String" || input.read(node.from, node.from + 1) !== "$") return null;
    const statement = node.node.parent;
    if (statement?.name !== "Statement") return null;

    const tokens: SyntaxNode[] = [];
    for (let child = statement.firstChild; child; child = child.nextSibling) {
      if (!child.name.endsWith("Comment")) tokens.push(child);
    }
    const words = tokens.map((token) => input.read(token.from, token.to).toLowerCase());
    const index = tokens.findIndex((token) => token.from === node.from);
    const isDo = words[0] === "do";
    const isRoutine = words[0] === "create" && tokens.some((token, i) =>
      token.name === "Keyword" && ["function", "procedure"].includes(words[i]));
    if (!isDo && !(isRoutine && words[index - 1] === "as")) return null;
    const languageIndex = tokens.findIndex((token, i) => token.name === "Keyword" && words[i] === "language");
    const language = languageIndex < 0 ? (isDo ? "plpgsql" : "") : words[languageIndex + 1]?.replace(/^["']|["']$/g, "");
    if (language !== "sql" && language !== "plpgsql") return null;

    // Parse only the body; nested dollar-quoted values remain PostgreSQL strings.
    const source = input.read(node.from, node.to);
    const delimiter = /^\$[^$]*\$/.exec(source)?.[0];
    if (!delimiter) return null;
    const from = node.from + delimiter.length;
    const to = node.to - (source.length >= delimiter.length * 2 && source.endsWith(delimiter) ? delimiter.length : 0);
    return from < to ? { parser: PostgreSQL.language.parser, overlay: [{ from, to }] } : null;
  }),
});

const dbpodHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--syntax-keyword)", fontWeight: "600" },
  { tag: [tags.bool, tags.null, tags.atom], color: "var(--syntax-atom)" },
  { tag: tags.string, color: "var(--syntax-string)" },
  { tag: tags.number, color: "var(--syntax-number)" },
  { tag: tags.comment, color: "var(--syntax-comment)", fontStyle: "italic" },
  { tag: [tags.typeName, tags.className], color: "var(--syntax-type)" },
  { tag: [tags.name, tags.variableName, tags.propertyName], color: "var(--syntax-name)" },
  { tag: [tags.operator, tags.operatorKeyword], color: "var(--syntax-operator)" },
]);

type Props = {
  initialSql: string;
  connectionId?: string;
  database?: string;
  readOnly?: boolean;
  onRun?: () => void;
  onRunNewResult?: () => void;
  onCancel?: () => void;
  onViewReady?: (view: EditorView | null) => void;
  onDocChanged?: (doc: string) => void;
};

export function SqlEditor({
  initialSql,
  connectionId,
  database,
  readOnly = false,
  onRun,
  onRunNewResult,
  onCancel,
  onViewReady,
  onDocChanged,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Latest callbacks without re-creating the editor.
  const runRef = useRef(onRun);
  const runNewRef = useRef(onRunNewResult);
  const cancelRef = useRef(onCancel);
  const docChangedRef = useRef(onDocChanged);
  runRef.current = onRun;
  runNewRef.current = onRunNewResult;
  cancelRef.current = onCancel;
  docChangedRef.current = onDocChanged;

  useEffect(() => {
    if (!hostRef.current) return;
    const shortcuts = getAppSettings().shortcuts;
    // basicSetup binds these itself. Ours sit above it, and a rebound entry
    // leaves an inert binding on the built-in key so the setting tells the truth.
    const searchBindings: Array<[string, Command, string]> = [
      [shortcuts.findInEditor, openSearchPanel, "Mod-f"],
      [shortcuts.findNext, findNext, "Mod-g"],
      [shortcuts.findPrevious, findPrevious, "Mod-Shift-g"],
      [shortcuts.gotoLine, gotoLine, "Mod-Alt-g"],
      [shortcuts.selectMatches, selectSelectionMatches, "Mod-Shift-l"],
      // Each press adds the next occurrence as another cursor; typing then edits every one.
      // basicSetup already allows multiple selections and draws them.
      [shortcuts.addNextMatch, selectNextOccurrence, "Mod-d"],
    ];
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initialSql,
        extensions: [
          basicSetup,
          // The editor pane is short, so the panel floats over the top-right
          // corner (see index.css) rather than eating a full-width strip.
          search({ top: true }),
          sql({ dialect: postgresWithRoutineBodies }),
          // Fuzzy, not prefix-only: names here are abbreviated and underscore-joined,
          // so the part a person remembers is rarely the part a name starts with.
          // CodeMirror ranks a prefix first, then a word start, then scattered letters,
          // which puts `fnn_fy_his` under `ffh` without burying it under `f`.
          ...(connectionId && database ? [autocompletion({ override: [sqlCompletionSource(connectionId, database)] })] : []),
          // The editor pane clips its overflow, so a completion list opening near
          // the bottom edge is cut off by the Result area below it.
          tooltips({ parent: document.body }),
          syntaxHighlighting(dbpodHighlightStyle),
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          EditorView.contentAttributes.of({ "aria-label": readOnly ? "정의 SQL" : "SQL 편집기", "aria-readonly": String(readOnly), tabindex: "0" }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) docChangedRef.current?.(u.state.doc.toString());
            if (u.selectionSet || u.docChanged) {
              u.view.dom.classList.toggle("dbpod-editor-has-selection", !u.state.selection.main.empty);
            }
          }),
          Prec.highest(
            keymap.of([
              // A shortcut the user cleared has no key to bind, and CodeMirror would
              // take the empty string for one.
              ...bind(shortcuts.runQueryNew, () => {
                if (!readOnly) runNewRef.current?.();
                return true;
              }),
              ...bind(shortcuts.runQuery, () => {
                if (!readOnly) runRef.current?.();
                return true;
              }),
              ...bind(shortcuts.formatSql, (target) => readOnly || formatSqlInEditor(target)),
              ...bind(shortcuts.cancelQueryAlternate, () => {
                cancelRef.current?.();
                return true;
              }),
              ...bind(shortcuts.cancelQuery, () => {
                cancelRef.current?.();
                return true;
              }),
              ...searchBindings.flatMap(([shortcut, command, builtIn]) => {
                const key = shortcutToCodeMirror(shortcut);
                if (!key) return [{ key: builtIn, run: () => true }];
                return key === builtIn
                  ? [{ key, run: command }]
                  : [{ key, run: command }, { key: builtIn, run: () => true }];
              }),
              ...(readOnly ? [] : [indentWithTab]),
            ]),
          ),
          EditorView.theme({
            "&": { height: "100%", fontSize: "var(--app-font-size)" },
            ".cm-scroller": { fontFamily: "var(--app-font-family)" },
          }),
        ],
      }),
    });
      onViewReady?.(view);
      view.dom.classList.toggle("dbpod-editor-has-selection", !view.state.selection.main.empty);
      return () => {
        onViewReady?.(null);
        view.destroy();
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={hostRef} className="h-full min-h-0 overflow-hidden" />;
}
