import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";

// VS Code's bracket pair colorization cycles three colours by depth.
const DEPTH_COLORS = 3;
const marks = Array.from({ length: DEPTH_COLORS }, (_, i) => Decoration.mark({ class: `cm-bracket-${i}` }));
const BRACKETS: Record<string, true> = { "(": true, ")": true, "[": true, "]": true, "{": true, "}": true };
const GROUPS: Record<string, true> = { Parens: true, Brackets: true, Braces: true };

/**
 * Colours brackets by nesting depth. The parser already pairs them and skips
 * those inside strings and comments, so depth is the count of enclosing groups.
 */
function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(view.state);
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (!BRACKETS[node.name]) return;
        let depth = -1;
        for (let parent = node.node.parent; parent; parent = parent.parent) if (GROUPS[parent.name]) depth++;
        // A bracket the parser could not pair has no group around it and stays uncoloured.
        if (depth >= 0) builder.add(node.from, node.to, marks[depth % DEPTH_COLORS]);
      },
    });
  }
  return builder.finish();
}

export const bracketColors = [
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) { this.decorations = build(view); }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state))
          this.decorations = build(update.view);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  ),
  // `*` covers a syntax-highlight span the mark may end up wrapping.
  EditorView.baseTheme(Object.fromEntries(marks.map((_, i) => [`.cm-bracket-${i}, .cm-bracket-${i} *`, { color: `var(--bracket-${i})` }]))),
];
