import { h } from "../dom";
import type { Child } from "../dom";

/** Native <dialog> with a hand-written focus trap: Tab wraps, Escape closes and returns focus to the opener. */

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]):not([type="hidden"]), a[href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogHandle {
  element: HTMLDialogElement;
  close: () => void;
}

interface DialogOptions {
  title: string;
  /** the dialog's accessible name when it differs from its heading */
  label?: string;
  /** Escape closes it. Match over keeps focus until the player leaves it. */
  escapeCloses?: boolean;
  /** where focus goes when it closes; defaults to the element focused when it opened */
  returnFocus?: HTMLElement | null;
  className?: string;
  onClose?: () => void;
  titleLevel?: 1 | 2;
}

let counter = 0;

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => !e.hasAttribute("hidden") && e.offsetParent !== null);
}

export function openDialog(options: DialogOptions, ...content: Child[]): DialogHandle {
  const id = `dialog-title-${++counter}`;
  const opener = options.returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const heading = h(options.titleLevel === 1 ? "h1" : "h2", { id, class: "dialog-title" }, options.title);
  const dialog = h(
    "dialog",
    { class: options.className ?? "dialog", ...(options.label ? { "aria-label": options.label } : { "aria-labelledby": id }) },
    heading,
    ...content,
  );
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    dialog.close();
    dialog.remove();
    options.onClose?.();
    if (opener && opener.isConnected) opener.focus();
  };
  dialog.addEventListener("cancel", (event) => event.preventDefault());
  dialog.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      if (options.escapeCloses !== false) close();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusables(dialog);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  });
  document.body.append(dialog);
  dialog.showModal();
  const preferred = dialog.querySelector<HTMLElement>("[autofocus]") ?? focusables(dialog)[0] ?? dialog;
  if (preferred === dialog) dialog.tabIndex = -1;
  preferred.focus();
  return { element: dialog, close };
}
