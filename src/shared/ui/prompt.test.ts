// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { confirmDialog, promptText } from "./prompt";

// jsdom does not implement showModal/close; the element contract is enough here.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});

const open = () => document.querySelector("dialog")!;

describe("promptText", () => {
  it("resolves the edited value on submit and removes the dialog", async () => {
    const pending = promptText("이름", "before");
    const input = open().querySelector("input")!;
    input.value = "after";
    open().querySelector<HTMLButtonElement>("button[type=submit]")!.click();
    open().close();
    expect(await pending).toBe("after");
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("resolves null when dismissed without submitting", async () => {
    const pending = promptText("이름", "before");
    open().close();
    expect(await pending).toBeNull();
  });
});

describe("confirmDialog", () => {
  it("resolves true only through 확인, and starts on 취소 so Enter cannot destroy anything", async () => {
    const pending = confirmDialog("버릴까요?");
    const buttons = [...open().querySelectorAll("button")];
    expect(open().textContent).toContain("버릴까요?");
    expect(document.activeElement?.textContent).toBe("취소");
    buttons.find((b) => b.textContent === "확인")!.click();
    expect(await pending).toBe(true);
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("resolves false on 취소 and on a plain dismiss", async () => {
    const declined = confirmDialog("버릴까요?");
    [...open().querySelectorAll("button")].find((b) => b.textContent === "취소")!.click();
    expect(await declined).toBe(false);
    const dismissed = confirmDialog("버릴까요?");
    open().close();
    expect(await dismissed).toBe(false);
  });
});
