import type { KeyboardEvent as ReactKeyboardEvent } from "react";

// Focus helpers adapted from kit/modules/a11y_dialog: the focusable list and Tab wrapping.
const FOCUSABLE =
  'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';

export function focusables(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.hasAttribute("disabled") && !el.closest("[inert]") && el.getClientRects().length > 0,
  );
}

/** Keeps Tab and Shift+Tab inside a container. */
export function wrapTab(event: KeyboardEvent | ReactKeyboardEvent, root: Element): void {
  if (event.key !== "Tab") return;
  const items = focusables(root);
  if (!items.length) {
    event.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !root.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !root.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

export function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement || target.isContentEditable) return true;
  if (!(target instanceof HTMLInputElement)) return false;
  return !["button", "checkbox", "radio", "file", "submit", "reset", "range", "color"].includes(target.type);
}

export function dialogOpen(): boolean {
  return document.querySelector("dialog[open]") !== null;
}

/** Focuses an element once it is in the document (after a render), unless focus has moved meanwhile. */
export function focusWhenReady(find: () => HTMLElement | null, tries = 30, from: Element | null = document.activeElement): void {
  const el = find();
  if (el) {
    el.focus();
    return;
  }
  if (tries > 0) {
    setTimeout(() => {
      if (document.activeElement === from || !from?.isConnected) focusWhenReady(find, tries - 1, from);
    }, 0);
  }
}
