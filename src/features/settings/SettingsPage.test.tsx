// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { resetAppSettings } from "../../entities/settings/appSettings";
import { SettingsPage } from "./SettingsPage";

const routerMock = vi.hoisted(() => ({ back: vi.fn(), navigate: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ history: { back: routerMock.back } }),
  useCanGoBack: () => true,
  useNavigate: () => routerMock.navigate,
}));

afterEach(() => { cleanup(); resetAppSettings(); routerMock.back.mockClear(); });

test("applies and persists appearance settings", () => {
  render(<SettingsPage />);
  fireEvent.change(screen.getByLabelText("테마"), { target: { value: "dark" } });
  fireEvent.change(screen.getByLabelText("폰트"), { target: { value: "mono" } });
  fireEvent.change(screen.getByLabelText("폰트 크기"), { target: { value: "18" } });

  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(document.documentElement.style.getPropertyValue("--app-font-family")).toContain("ui-monospace");
  expect(document.documentElement.style.getPropertyValue("--app-font-size")).toBe("18px");
  expect(localStorage.getItem("dbpod.app-settings.v1")).toContain('"fontSize":18');
});

test("records custom shortcuts and rejects conflicts", () => {
  render(<SettingsPage />);
  const split = screen.getByRole("button", { name: "패널 분할 단축키" });
  fireEvent.click(split);
  fireEvent.blur(split);
  fireEvent.keyDown(window, { key: "k", code: "KeyK", metaKey: true });
  expect(split.textContent).toMatch(/K/);

  const nextPanel = screen.getByRole("button", { name: "다음 패널 단축키" });
  fireEvent.click(nextPanel);
  fireEvent.keyDown(nextPanel, { key: "k", code: "KeyK", metaKey: true });
  expect(screen.getByRole("alert").textContent).toContain("패널 분할");
});

test("the close-tab shortcut leaves settings for the previous screen", () => {
  render(<SettingsPage />);
  fireEvent.keyDown(window, { key: "w", code: "KeyW", metaKey: true });
  expect(routerMock.back).toHaveBeenCalled();
});

test("the close button leaves settings for the previous screen", () => {
  render(<SettingsPage />);
  fireEvent.click(screen.getByRole("button", { name: "설정 닫기" }));
  expect(routerMock.back).toHaveBeenCalledTimes(1);
});

test("while recording, the close-tab shortcut is captured instead of closing", () => {
  render(<SettingsPage />);
  const closeTab = screen.getByRole("button", { name: "현재 탭 닫기 단축키" });
  fireEvent.click(closeTab);
  fireEvent.keyDown(window, { key: "w", code: "KeyW", metaKey: true, shiftKey: true });
  expect(routerMock.back).not.toHaveBeenCalled();
  expect(closeTab.textContent).toMatch(/Shift/);
});

test("clears a shortcut and stores it as cleared", () => {
  render(<SettingsPage />);
  fireEvent.click(screen.getByRole("button", { name: "현재 SQL 실행 단축키 해제" }));
  expect(screen.getByRole("button", { name: "현재 SQL 실행 단축키" }).textContent).toBe("없음");
  expect(screen.getByRole("button", { name: "현재 SQL 실행 단축키 해제" }).hasAttribute("disabled")).toBe(true);
  // Stored empty rather than dropped: a missing key would come back as the default
  // the user just removed. That the loader keeps it is isValidShortcut's test.
  expect(localStorage.getItem("dbpod.app-settings.v1")).toContain('"runQuery":""');
});

test("Backspace while recording clears the shortcut", () => {
  render(<SettingsPage />);
  const split = screen.getByRole("button", { name: "패널 분할 단축키" });
  fireEvent.click(split);
  fireEvent.keyDown(window, { key: "Backspace", code: "Backspace" });
  expect(split.textContent).toBe("없음");
});

test("lists the result tab shortcuts under the grid group", () => {
  render(<SettingsPage />);
  expect(screen.getByRole("button", { name: "이전 Result 탭 단축키" }).textContent).toContain("←");
  expect(screen.getByRole("button", { name: "다음 Result 탭 단축키" }).textContent).toContain("→");
});
