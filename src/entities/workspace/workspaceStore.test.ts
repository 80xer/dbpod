import { describe, expect, it } from "vitest";
import {
  emptyWorkspace,
  workspaceReducer,
  type WorkspaceAction,
  type WorkspaceState,
} from "./workspaceStore";

function apply(state: WorkspaceState, ...actions: WorkspaceAction[]): WorkspaceState {
  return actions.reduce(workspaceReducer, state);
}

describe("workspaceReducer", () => {
  it("adds tabs with sequential default names and activates them", () => {
    const s = apply(
      emptyWorkspace(),
      { type: "TAB_ADDED", tabId: "a" },
      { type: "TAB_ADDED", tabId: "b" },
    );
    expect(s.tabs.map((t) => t.title)).toEqual(["Query 1", "Query 2"]);
    expect(s.activeTabId).toBe("b");
  });

  it("closing the active tab activates its neighbor", () => {
    const s = apply(
      emptyWorkspace(),
      { type: "TAB_ADDED", tabId: "a" },
      { type: "TAB_ADDED", tabId: "b" },
      { type: "TAB_ADDED", tabId: "c" },
      { type: "TAB_ACTIVATED", tabId: "b" },
      { type: "TAB_CLOSED", tabId: "b" },
    );
    expect(s.tabs.map((t) => t.id)).toEqual(["a", "c"]);
    expect(s.activeTabId).toBe("c");
  });

  it("cycles tabs in both directions with wrap-around", () => {
    let s = apply(
      emptyWorkspace(),
      { type: "TAB_ADDED", tabId: "a" },
      { type: "TAB_ADDED", tabId: "b" },
    );
    s = apply(s, { type: "TAB_CYCLED", direction: 1 });
    expect(s.activeTabId).toBe("a");
    s = apply(s, { type: "TAB_CYCLED", direction: -1 });
    expect(s.activeTabId).toBe("b");
  });

  it("adds result tabs with global sequential numbering and activates them", () => {
    const s = apply(
      emptyWorkspace(),
      { type: "TAB_ADDED", tabId: "a" },
      { type: "RESULT_ADDED", tabId: "a", resultTabId: "r1" },
      { type: "RESULT_ADDED", tabId: "a", resultTabId: "r2" },
    );
    const tab = s.tabs[0];
    expect(tab.resultTabs.map((r) => r.title)).toEqual(["Result 1", "Result 2"]);
    expect(tab.activeResultTabId).toBe("r2");
  });

  it("closing the active result activates its neighbor", () => {
    const s = apply(
      emptyWorkspace(),
      { type: "TAB_ADDED", tabId: "a" },
      { type: "RESULT_ADDED", tabId: "a", resultTabId: "r1" },
      { type: "RESULT_ADDED", tabId: "a", resultTabId: "r2" },
      { type: "RESULT_ACTIVATED", tabId: "a", resultTabId: "r1" },
      { type: "RESULT_CLOSED", tabId: "a", resultTabId: "r1" },
    );
    expect(s.tabs[0].activeResultTabId).toBe("r2");
  });

  it("tracks execution lifecycle on tab and result", () => {
    let s = apply(
      emptyWorkspace(),
      { type: "TAB_ADDED", tabId: "a" },
      { type: "RESULT_ADDED", tabId: "a", resultTabId: "r1" },
      {
        type: "EXECUTION_STARTED",
        tabId: "a",
        resultTabId: "r1",
        executionId: "e1",
        sessionId: "s1",
      },
    );
    expect(s.tabs[0].runningExecutionId).toBe("e1");
    expect(s.tabs[0].resultTabs[0].isRunning).toBe(true);
    s = apply(s, { type: "EXECUTION_ENDED", tabId: "a", resultTabId: "r1" });
    expect(s.tabs[0].runningExecutionId).toBeUndefined();
    expect(s.tabs[0].resultTabs[0].isRunning).toBe(false);
    expect(s.tabs[0].sessionId).toBe("s1");
  });

  it("pin toggling flips only the target result", () => {
    const s = apply(
      emptyWorkspace(),
      { type: "TAB_ADDED", tabId: "a" },
      { type: "RESULT_ADDED", tabId: "a", resultTabId: "r1" },
      { type: "RESULT_ADDED", tabId: "a", resultTabId: "r2" },
      { type: "RESULT_PIN_TOGGLED", tabId: "a", resultTabId: "r1" },
    );
    expect(s.tabs[0].resultTabs.map((r) => r.isPinned)).toEqual([true, false]);
  });
});
