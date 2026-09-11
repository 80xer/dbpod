// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppShell } from "./AppShell";
import { emptyWorkspace, workspaceReducer, workspaceStates } from "../../entities/workspace/workspaceStore";
import { editStore } from "../../entities/result/editStore";
const mock = vi.hoisted(() => ({ handler: undefined as undefined | ((event: { preventDefault: () => void }) => Promise<void>), save: vi.fn(), close: vi.fn(), destroy: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ onCloseRequested: async (handler: typeof mock.handler) => { mock.handler = handler; return () => {}; }, destroy: mock.destroy }) }));
vi.mock("@tanstack/react-router", () => ({ Link: () => null, Outlet: () => null, useParams: () => ({}) }));
vi.mock("../../shared/ipc/invoke", () => ({ ipc: { connectionClose: mock.close } }));
vi.mock("../../entities/workspace/persistence", () => ({ getPersistenceError: () => "", subscribePersistence: () => () => {}, saveWorkspaceNow: mock.save }));
beforeEach(() => {
  vi.clearAllMocks(); Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  workspaceStates.clear(); editStore.clear("r");
  workspaceStates.set("c", workspaceReducer(workspaceReducer(emptyWorkspace(), { type: "TAB_ADDED", tabId: "t" }), { type: "RESULT_ADDED", tabId: "t", resultTabId: "r" }));
  mock.save.mockResolvedValue(undefined); mock.close.mockResolvedValue(undefined); mock.destroy.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function closeWindow() { render(<AppShell />); await act(async () => { await mock.handler?.({ preventDefault: vi.fn() }); }); }

test("native close persists drafts before disconnecting and destroying the window", async () => {
  const order: string[] = [];
  mock.save.mockImplementation(async () => { order.push("save"); }); mock.close.mockImplementation(async () => { order.push("close"); }); mock.destroy.mockImplementation(async () => { order.push("destroy"); });
  await closeWindow(); expect(order).toEqual(["save", "close", "destroy"]);
});
test("native close refuses to discard a commit in progress", async () => {
  editStore.setLocked("r", true); await closeWindow();
  expect(mock.save).not.toHaveBeenCalled(); expect(mock.destroy).not.toHaveBeenCalled(); expect(screen.getByRole("alert").textContent).toContain("저장");
});
test("failed snapshot save leaves the window and database connection open", async () => {
  mock.save.mockRejectedValue(new Error("disk full")); await closeWindow();
  expect(mock.close).not.toHaveBeenCalled(); expect(mock.destroy).not.toHaveBeenCalled(); expect(screen.getByRole("alert").textContent).toContain("disk full");
});

test("blocks Backspace navigation outside editable fields while preserving text deletion", () => {
  render(<><AppShell />
    <button>일반 버튼</button>
    <div role="grid" tabIndex={0}>결과</div>
    <input aria-label="문자 입력" />
    <input aria-label="검색" type="search" />
    <input aria-label="체크박스" type="checkbox" />
    <input aria-label="읽기 전용" readOnly />
    <fieldset disabled><input aria-label="비활성 입력" /></fieldset>
    <textarea aria-label="셀 편집" />
    <div contentEditable suppressContentEditableWarning><span>SQL 편집 내용</span><span contentEditable={false}>읽기 전용 내용</span></div>
  </>);
  const backspace = (target: Element, shiftKey = false) => {
    const event = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true, shiftKey });
    fireEvent(target, event);
    return event.defaultPrevented;
  };
  for (const target of [document.body, screen.getByRole("button"), screen.getByRole("grid"),
    screen.getByLabelText("체크박스"), screen.getByLabelText("읽기 전용"), screen.getByLabelText("비활성 입력"), screen.getByText("읽기 전용 내용")]) {
    expect(backspace(target)).toBe(true);
    expect(backspace(target, true)).toBe(true);
  }
  for (const target of [screen.getByLabelText("문자 입력"), screen.getByLabelText("검색"), screen.getByLabelText("셀 편집"), screen.getByText("SQL 편집 내용")]) {
    expect(backspace(target)).toBe(false);
  }
  const closeWindow = new KeyboardEvent("keydown", { key: "w", code: "KeyW", metaKey: true, bubbles: true, cancelable: true });
  fireEvent(document.body, closeWindow);
  expect(closeWindow.defaultPrevented).toBe(true);
  cleanup();
  expect(backspace(document.body)).toBe(false);
});
