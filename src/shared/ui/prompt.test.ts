// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { promptText } from "./prompt";

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
