import { PostgreSQL, sql } from "@codemirror/lang-sql";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";

type Props = {
  initialSql: string;
  onRun: () => void;
  onCancel: () => void;
  onViewReady: (view: EditorView) => void;
};

export function SqlEditor({ initialSql, onRun, onCancel, onViewReady }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Latest callbacks without re-creating the editor.
  const runRef = useRef(onRun);
  const cancelRef = useRef(onCancel);
  runRef.current = onRun;
  cancelRef.current = onCancel;

  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initialSql,
        extensions: [
          basicSetup,
          sql({ dialect: PostgreSQL }),
          Prec.highest(
            keymap.of([
              {
                key: "Mod-Enter",
                run: () => {
                  runRef.current();
                  return true;
                },
              },
              {
                key: "Mod-.",
                run: () => {
                  cancelRef.current();
                  return true;
                },
              },
              {
                key: "Escape",
                run: () => {
                  cancelRef.current();
                  return true;
                },
              },
            ]),
          ),
          EditorView.theme({
            "&": { height: "100%", fontSize: "13px" },
            ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
          }),
        ],
      }),
    });
    onViewReady(view);
    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={hostRef} className="h-full min-h-0 overflow-hidden" />;
}
