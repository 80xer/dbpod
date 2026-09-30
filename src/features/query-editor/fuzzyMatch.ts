import type { Completion, CompletionResult } from "@codemirror/autocomplete";

export type FuzzyMatch = { start: number; span: number; ranges: number[] };

/**
 * Case-insensitive subsequence match, the way VS Code's Cmd+P matches file names:
 * the typed letters must appear in order, but anywhere in the name, including a
 * single letter that is not the name's first.
 *
 * Each letter is taken as early as it can be. That gives the earliest start any
 * match could have and, from that start, the tightest span.
 */
export function fuzzyMatch(pattern: string, label: string): FuzzyMatch | null {
  const haystack = label.toLowerCase();
  const ranges: number[] = [];
  let at = 0;
  for (const char of pattern.toLowerCase()) {
    const index = haystack.indexOf(char, at);
    if (index < 0) return null;
    if (ranges.length && ranges[ranges.length - 1] === index) ranges[ranges.length - 1] = index + char.length;
    else ranges.push(index, index + char.length);
    at = index + char.length;
  }
  return ranges.length ? { start: ranges[0], span: at - ranges[0], ranges } : { start: 0, span: 0, ranges };
}

/**
 * A completion result filtered and ordered here instead of by CodeMirror, whose
 * matcher only takes a single letter at the start of a name and never scatters two.
 *
 * Order: where the match starts (earlier first), then how tight it is, then the
 * shorter name, then alphabetical. No `validFor`: an unfiltered result cannot be
 * reused, so the source runs again on every keystroke.
 */
export function fuzzyResult(from: number, pattern: string, options: Completion[]): CompletionResult {
  const ranges = new Map<Completion, number[]>();
  const ranked = options.flatMap((option) => {
    const match = fuzzyMatch(pattern, option.label);
    if (!match) return [];
    ranges.set(option, match.ranges);
    return [{ option, match }];
  });
  ranked.sort((a, b) =>
    a.match.start - b.match.start
    || a.match.span - b.match.span
    || (pattern ? a.option.label.length - b.option.label.length : 0)
    || a.option.label.localeCompare(b.option.label));
  return {
    from,
    options: ranked.map(({ option }) => option),
    filter: false,
    getMatch: (option) => ranges.get(option) ?? [],
  };
}
