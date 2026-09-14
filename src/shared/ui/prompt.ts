/**
 * Tauri's webview implements alert() and confirm() but not prompt(), which
 * resolves to null without showing anything. Native <dialog> covers the gap.
 */
export function promptText(message: string, defaultValue = ""): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    // Tailwind's preflight zeroes every margin, which drops <dialog>'s own
    // centering, so m-auto has to put it back.
    dialog.className = "m-auto rounded border border-gray-300 p-0 shadow-lg backdrop:bg-black/30";
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
    cancel.className = "rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50";
    const ok = document.createElement("button");
    ok.type = "submit";
    ok.textContent = "확인";
    ok.className = "rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700";
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
