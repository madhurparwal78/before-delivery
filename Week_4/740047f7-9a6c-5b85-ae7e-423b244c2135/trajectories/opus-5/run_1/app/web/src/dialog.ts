import { h } from "./dom";

export interface DialogHandle {
  root: HTMLElement;
  close(): void;
}

interface Entry {
  backdrop: HTMLElement;
  dialog: HTMLElement;
  opener: HTMLElement | null;
}

const stack: Entry[] = [];

export function anyDialogOpen(): boolean {
  return stack.length > 0;
}

function focusable(root: HTMLElement): HTMLElement[] {
  const selector =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return [...root.querySelectorAll<HTMLElement>(selector)].filter(
    (node) => node.offsetParent !== null || node === document.activeElement,
  );
}

export function openDialog(options: {
  name: string;
  build: (handle: DialogHandle) => Node;
  initialFocus?: (root: HTMLElement) => HTMLElement | null;
}): DialogHandle {
  const opener = document.activeElement as HTMLElement | null;
  const dialog = h("div", {
    class: "dialog",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": options.name,
    tabindex: "-1",
  });
  const backdrop = h("div", { class: "scrim-backdrop" }, dialog);

  const entry: Entry = { backdrop, dialog, opener };
  const handle: DialogHandle = {
    root: dialog,
    close(): void {
      const index = stack.indexOf(entry);
      if (index === -1) return;
      stack.splice(index, 1);
      document.removeEventListener("keydown", onKey, true);
      backdrop.remove();
      entry.opener?.focus();
    },
  };

  /// Escape closes the top dialog alone, wherever focus happens to be.
  const onKey = (keyboard: KeyboardEvent): void => {
    if (stack[stack.length - 1] !== entry) return;
    if (keyboard.key === "Escape") {
      keyboard.stopPropagation();
      keyboard.preventDefault();
      handle.close();
      return;
    }
    if (keyboard.key !== "Tab") return;
    const items = focusable(dialog);
    if (items.length === 0) {
      keyboard.preventDefault();
      dialog.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (keyboard.shiftKey && (active === first || !dialog.contains(active))) {
      keyboard.preventDefault();
      last.focus();
    } else if (!keyboard.shiftKey && (active === last || !dialog.contains(active))) {
      keyboard.preventDefault();
      first.focus();
    }
  };

  dialog.appendChild(options.build(handle));
  backdrop.addEventListener("mousedown", (pointer) => {
    if (pointer.target === backdrop) handle.close();
  });
  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(backdrop);
  stack.push(entry);
  const target = options.initialFocus?.(dialog) ?? focusable(dialog)[0] ?? dialog;
  target.focus();
  return handle;
}

/// Confirm dialogs place initial focus on their cancel control.
export function confirmDialog(options: {
  name: string;
  heading: string;
  body?: Node;
  confirmLabel: string;
  onConfirm: (handle: DialogHandle) => void;
}): DialogHandle {
  return openDialog({
    name: options.name,
    build: (handle) => {
      const cancel = h("button", { type: "button", class: "text-button" }, "Cancel");
      cancel.addEventListener("click", () => handle.close());
      const confirm = h(
        "button",
        { type: "button", class: "text-button" },
        options.confirmLabel,
      );
      confirm.addEventListener("click", () => options.onConfirm(handle));
      return h("div", {}, [
        h("h2", {}, options.heading),
        options.body ?? null,
        h("div", { class: "actions" }, [cancel, confirm]),
      ]);
    },
    initialFocus: (root) => root.querySelector("button"),
  });
}

