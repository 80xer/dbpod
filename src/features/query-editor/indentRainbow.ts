import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";

// Matches the editor's indentUnit and the formatter's tabWidth.
const UNIT = 4;
// indent-rainbow's palette at 13%: its default 7% vanished on this editor background, 18% was too heavy.
const COLORS = ["rgba(255,255,64,0.13)", "rgba(127,255,127,0.13)", "rgba(255,127,255,0.13)", "rgba(79,236,236,0.13)"];
const marks = COLORS.map((_, i) => Decoration.mark({ class: `cm-indent-rainbow-${i}` }));

/** Colours each full indent step of leading whitespace in turn; a partial step stays plain. */
function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      const indent = /^[ \t]*/.exec(line.text)![0];
      let column = 0;
      let start = line.from;
      for (let i = 0; i < indent.length; i++) {
        column += indent[i] === "\t" ? UNIT - (column % UNIT) : 1;
        if (column % UNIT === 0) {
          builder.add(start, line.from + i + 1, marks[(column / UNIT - 1) % marks.length]);
          start = line.from + i + 1;
        }
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

export const indentRainbow = [
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) { this.decorations = build(view); }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) this.decorations = build(update.view);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  ),
  EditorView.baseTheme(Object.fromEntries(COLORS.map((color, i) => [`.cm-indent-rainbow-${i}`, { backgroundColor: color }]))),
];
