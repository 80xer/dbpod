import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbValue } from "../../generated/ipc-types";
import { resultStore } from "./resultStore";

const row = (n: number): DbValue[] => [{ t: "int", v: n }];

describe("resultStore", () => {
  const tab = "tab-1";

  beforeEach(() => {
    resultStore.dispose(tab);
    resultStore.create(tab);
  });

  it("appends chunks in sequence and notifies subscribers", () => {
    const listener = vi.fn();
    resultStore.subscribe(tab, listener);
    resultStore.appendRows(tab, 0, [row(1), row(2)]);
    resultStore.appendRows(tab, 1, [row(3)]);
    const s = resultStore.getSnapshot(tab);
    expect(s.rows).toHaveLength(3);
    expect(listener).toHaveBeenCalled();
  });

  it("changes snapshot identity on every update", () => {
    const before = resultStore.getSnapshot(tab);
    resultStore.appendRows(tab, 0, [row(1)]);
    expect(resultStore.getSnapshot(tab)).not.toBe(before);
  });

  it("flags out-of-order chunks as an internal error", () => {
    resultStore.appendRows(tab, 1, [row(1)]);
    const s = resultStore.getSnapshot(tab);
    expect(s.status).toBe("failed");
    expect(s.error?.code).toBe("INTERNAL_ERROR");
  });

  it("dispose frees rows and later chunks are ignored", () => {
    resultStore.appendRows(tab, 0, [row(1)]);
    resultStore.dispose(tab);
    expect(resultStore.getSnapshot(tab).rows).toHaveLength(0);
    resultStore.appendRows(tab, 1, [row(2)]); // late chunk, no crash
    expect(resultStore.getSnapshot(tab).status).toBe("idle");
  });

  it("records terminal state", () => {
    resultStore.setTerminal(tab, {
      status: "completed",
      rowCount: 5,
      truncated: false,
      durationMs: 12,
      transactionState: "idle",
    });
    const s = resultStore.getSnapshot(tab);
    expect(s.status).toBe("completed");
    expect(s.rowCount).toBe(5);
  });
});
