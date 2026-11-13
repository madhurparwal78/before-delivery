// Every dialog wraps Tab and Shift+Tab among its own controls, closes on
// Escape and returns focus to its opener.

import { clear, el, on, queryAll, reducedMotion } from "./dom";

export type Dialog = {
  node: HTMLElement;
  close: (returnFocus?: boolean) => void;
};

const stack: Dialog[] = [];

export function dialogOpen(): boolean {
  return stack.length > 0;
}

function topDialog(): Dialog | null {
  return stack.length ? stack[stack.length - 1] : null;
}

/** dialogNamed reports whether a dialog with that name is already open. */
export function dialogNamed(name: string): boolean {
  return stack.some((dialog) => dialog.node.getAttribute("aria-label") === name);
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type DialogOptions = {
  title: string;
  opener?: HTMLElement | null;
  onClose?: (returnFocus: boolean) => void;
  className?: string;
  sheet?: boolean;
};

/** openDialog shows a dialog and holds focus inside it. */
export function openDialog(options: DialogOptions, build: (body: HTMLElement, dialog: Dialog) => void): Dialog {
  const overlays = document.getElementById("overlays");
  if (!overlays) throw new Error("overlays missing");
  const backdrop = el("div", { class: "backdrop" });
  const node = el("div", {
    role: "dialog",
    "aria-modal": "true",
    "aria-label": options.title,
    class: `dialog ${options.className ?? ""} ${options.sheet ? "sheet" : ""} ${reducedMotion() ? "still" : ""}`,
  });
  backdrop.append(node);
  overlays.append(backdrop);

  const dialog: Dialog = {
    node,
    close(returnFocus = true) {
      const index = stack.indexOf(dialog);
      if (index === -1) return;
      stack.splice(index, 1);
      backdrop.remove();
      options.onClose?.(returnFocus);
      if (returnFocus && options.opener && options.opener.isConnected) options.opener.focus();
    },
  };
  stack.push(dialog);
  build(node, dialog);

  on(node, "keydown", (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dialog.close();
      return;
    }
    if (event.key !== "Tab") return;
    const items = queryAll<HTMLElement>(FOCUSABLE, node).filter((item) => item.offsetParent !== null || item === document.activeElement);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  on(backdrop, "pointerdown", (event: PointerEvent) => {
    if (event.target === backdrop) dialog.close();
  });

  const firstField = node.querySelector<HTMLElement>(FOCUSABLE);
  if (firstField) {
    firstField.focus();
  } else {
    node.setAttribute("tabindex", "-1");
    node.focus();
  }
  return dialog;
}

// Escape closes the dialog on top wherever focus happens to be.
document.addEventListener(
  "keydown",
  (event) => {
    if (event.key !== "Escape") return;
    const top = topDialog();
    if (!top || top.node.contains(document.activeElement)) return;
    event.preventDefault();
    top.close();
  },
  true,
);

export function closeAllDialogs(): void {
  while (stack.length) stack[stack.length - 1].close(false);
}

/** confirmScope asks the published scope question before a repeating change. */
export function scopeDialog(
  title: "Edit repeating event" | "Delete repeating event",
  opener: HTMLElement | null,
  onChoose: (scope: "this" | "following" | "all") => void,
  onCancel?: () => void,
): void {
  let chosen: "this" | "following" | "all" = "this";
  let decided = false;
  openDialog(
    {
      title,
      opener,
      onClose: () => {
        if (!decided) onCancel?.();
      },
    },
    (body, dialog) => {
      const group = el("div", { role: "radiogroup", "aria-label": "Apply to", class: "scope-group" });
      const options: { value: "this" | "following" | "all"; label: string }[] = [
        { value: "this", label: "This event" },
        { value: "following", label: "This and following events" },
        { value: "all", label: "All events" },
      ];
      const radios: HTMLElement[] = [];
      options.forEach((option, index) => {
        const radio = el("div", {
          role: "radio",
          "aria-checked": index === 0 ? "true" : "false",
          tabindex: index === 0 ? "0" : "-1",
          class: "radio",
          text: option.label,
        });
        on(radio, "click", () => select(index));
        radios.push(radio);
        group.append(radio);
      });
      function select(index: number): void {
        chosen = options[index].value;
        radios.forEach((radio, position) => {
          radio.setAttribute("aria-checked", position === index ? "true" : "false");
          radio.setAttribute("tabindex", position === index ? "0" : "-1");
        });
        radios[index].focus();
      }
      on(group, "keydown", (event: KeyboardEvent) => {
        const current = options.findIndex((option) => option.value === chosen);
        if (event.key === "ArrowDown" || event.key === "ArrowRight") {
          event.preventDefault();
          select((current + 1) % options.length);
        } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
          event.preventDefault();
          select((current - 1 + options.length) % options.length);
        }
      });
      const confirmLabel = title === "Delete repeating event" ? "Delete" : "OK";
      const confirm = el("button", { type: "button", class: "primary", text: confirmLabel });
      const cancel = el("button", { type: "button", text: "Cancel" });
      on(confirm, "click", () => {
        decided = true;
        dialog.close(false);
        onChoose(chosen);
      });
      on(cancel, "click", () => dialog.close());
      clear(body);
      body.append(
        el("h2", { text: title }),
        group,
        el("div", { class: "row buttons" }, [confirm, cancel]),
      );
      radios[0].focus();
    },
  );
}
