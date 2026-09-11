import { PostgreSQL, sql } from "@codemirror/lang-sql";
import { autocompletion } from "@codemirror/autocomplete";
import { indentWithTab } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { parseMixed, type SyntaxNode } from "@lezer/common";
import { tags } from "@lezer/highlight";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";
import { getAppSettings } from "../../entities/settings/appSettings";
import { shortcutToCodeMirror } from "../../entities/settings/shortcuts";
import { sqlCompletionSource } from "./sqlCompletion";

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
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initialSql,
        extensions: [
          basicSetup,
          sql({ dialect: postgresWithRoutineBodies }),
          ...(connectionId && database ? [autocompletion({ override: [sqlCompletionSource(connectionId, database)] })] : []),
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
              {
                key: shortcutToCodeMirror(shortcuts.runQueryNew),
                run: () => {
                  if (!readOnly) runNewRef.current?.();
                  return true;
                },
              },
              {
                key: shortcutToCodeMirror(shortcuts.runQuery),
                run: () => {
                  if (!readOnly) runRef.current?.();
                  return true;
                },
              },
              {
                key: shortcutToCodeMirror(shortcuts.cancelQueryAlternate),
                run: () => {
                  cancelRef.current?.();
                  return true;
                },
              },
              {
                key: shortcutToCodeMirror(shortcuts.cancelQuery),
                run: () => {
                  cancelRef.current?.();
                  return true;
                },
              },
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
