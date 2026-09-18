// Tailwind's preflight zeroes every margin, which drops <dialog>'s own
// centering, so m-auto has to put it back.
const dialogClass = "m-auto rounded border border-gray-300 p-0 shadow-lg backdrop:bg-black/30";
const cancelClass = "rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50";
const okClass = "rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700";

/**
 * Neither browser dialog works here. wry's WKWebView implements none of
 * alert/confirm/prompt, and tauri-plugin-dialog (needed for the save-file
 * dialog) then replaces window.confirm with an *async* wrapper whose Promise
 * is truthy at once — so `if (!confirm(...))` never blocks, and without the
 * dialog capability no dialog is shown either. Native <dialog> covers both.
 */
export function promptText(message: string, defaultValue = ""): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = dialogClass;
    const form = document.createElement("form");
    form.method = "dialog";
    form.className = "flex w-72 flex-col gap-2 p-3";
    const label = document.createElement("label");
    label.className = "text-xs text-gray-700";
    label.textContent = message;
    const input = document.createElement("input");
    input.type = "text";
    input.value = defaultValue;
    input.className = "w-full rounded border border-gray-300 px-2 py-1 text-xs";
    label.appendChild(input);
    const buttons = document.createElement("div");
    buttons.className = "flex justify-end gap-2";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "취소";
    cancel.className = cancelClass;
    const ok = document.createElement("button");
    ok.type = "submit";
    ok.textContent = "확인";
    ok.className = okClass;
    buttons.append(cancel, ok);
    form.append(label, buttons);
    dialog.appendChild(form);

    // Escape and 취소 both close without a value; only submit carries one.
    let value: string | null = null;
    ok.addEventListener("click", () => { value = input.value; });
    cancel.addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(value);
    });
    document.body.appendChild(dialog);
    dialog.showModal();
    input.select();
  });
}

/** 취소 holds focus, so a stray Enter on a destructive question keeps the data. */
export function confirmDialog(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = dialogClass;
    dialog.setAttribute("role", "alertdialog");
    const body = document.createElement("div");
    body.className = "flex w-80 flex-col gap-3 p-3";
    const text = document.createElement("p");
    text.id = `confirm-${Math.random().toString(36).slice(2)}`;
    text.className = "whitespace-pre-wrap text-xs text-gray-700";
    text.textContent = message;
    dialog.setAttribute("aria-labelledby", text.id);
    const buttons = document.createElement("div");
    buttons.className = "flex justify-end gap-2";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "취소";
    cancel.className = cancelClass;
    const ok = document.createElement("button");
    ok.type = "button";
    ok.textContent = "확인";
    ok.className = okClass;
    buttons.append(cancel, ok);
    body.append(text, buttons);
    dialog.appendChild(body);

    let accepted = false;
    ok.addEventListener("click", () => { accepted = true; dialog.close(); });
    cancel.addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(accepted);
    });
    document.body.appendChild(dialog);
    dialog.showModal();
    cancel.focus();
  });
}
