// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { resetAppSettings } from "../../entities/settings/appSettings";
import { SettingsPage } from "./SettingsPage";

vi.mock("@tanstack/react-router", () => ({ Link: ({ children, to, ...props }: ComponentProps<"a"> & { to: string }) => <a href={to} {...props}>{children}</a> }));

afterEach(() => { cleanup(); resetAppSettings(); });

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
