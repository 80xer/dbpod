import { expect, it } from "vitest";
import { fuzzyMatch, fuzzyResult } from "./fuzzyMatch";

const labels = (pattern: string, names: string[]) =>
  fuzzyResult(0, pattern, names.map((label) => ({ label }))).options.map((option) => option.label);

it("matches letters in order anywhere in the name, ignoring case", () => {
  expect(fuzzyMatch("ym", "clsg_ym")?.ranges).toEqual([5, 7]);
  expect(fuzzyMatch("CYM", "clsg_ym")?.ranges).toEqual([0, 1, 5, 7]);
  expect(fuzzyMatch("mc", "clsg_ym")).toBeNull();
});

it("ranks by match start, then tightness, then length, then name", () => {
  expect(labels("id", ["user_id", "id", "paid_amt", "idx_id"])).toEqual(["id", "idx_id", "paid_amt", "user_id"]);
  expect(labels("ab", ["a_b", "ab", "axxb"])).toEqual(["ab", "a_b", "axxb"]);
  expect(labels("", ["b", "aa", "a"])).toEqual(["a", "aa", "b"]);
});
