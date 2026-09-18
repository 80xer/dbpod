import { describe, expect, it } from "vitest";
import { formatRange } from "./formatSql";

describe("formatRange", () => {
  const doc = "select 1;\n\nselect 2 from t;\n";

  it("covers only the statement under the cursor, without its blank lines", () => {
    const range = formatRange(doc, doc.indexOf("2"), doc.indexOf("2"));
    expect(doc.slice(range!.from, range!.to)).toBe("select 2 from t");
  });

  it("keeps an explicit selection as-is", () => {
    const range = formatRange(doc, 0, 9);
    expect(range).toEqual({ from: 0, to: 9 });
  });

  it("returns null when there is nothing to format", () => {
    expect(formatRange("   \n\n  ", 3, 3)).toBeNull();
  });
});
