// A modal <dialog> that keeps Tab and Shift+Tab inside, closes on Escape and returns focus to its opener.
// Adapted from the kit's a11y_dialog module; it rises and fades in, and fades out before closing.

import { prefersReducedMotion } from "./dom.js";

const CLOSE_MS = 90;
const FOCUSABLE = "button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";

export interface OpenDialog {
  close(): void;
}

export function openDialog(dialog: HTMLDialogElement, opener: HTMLElement, first: HTMLElement): OpenDialog {
  let open = true;
  dialog.classList.remove("is-closing");
  dialog.showModal();
  first.focus();

  const focusables = () => [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hidden);

  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") {
      const items = focusables();
      const edge = event.shiftKey ? items[0] : items.at(-1);
      if (document.activeElement === edge || !dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? items.at(-1) : items[0])?.focus();
      }
    }
  };
  const onCancel = (event: Event) => {
    event.preventDefault();
    close();
  };

  function finish(): void {
    dialog.classList.remove("is-closing");
    dialog.close();
    if (opener.isConnected) opener.focus();
  }

  function close(): void {
    if (!open) return;
    open = false;
    dialog.removeEventListener("keydown", onKey);
    dialog.removeEventListener("cancel", onCancel);
    if (prefersReducedMotion()) {
      finish();
      return;
    }
    dialog.classList.add("is-closing");
    setTimeout(finish, CLOSE_MS);
  }

  dialog.addEventListener("keydown", onKey);
  dialog.addEventListener("cancel", onCancel);
  return { close };
}
