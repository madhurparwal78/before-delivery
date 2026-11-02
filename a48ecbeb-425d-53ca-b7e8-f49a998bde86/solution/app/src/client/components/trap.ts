import type { KeyboardEvent } from "react";

// Keyboard containment for dialogs (adapted from kit/modules/a11y_dialog): Tab and Shift+Tab
// wrap at either end, and Escape closes.

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => !e.closest("[inert]") && e.getClientRects().length > 0);
}

export function trapKeys(event: KeyboardEvent<HTMLElement>, close: () => void): void {
  if (event.key === "Escape") {
    event.preventDefault();
    close();
    return;
  }
  if (event.key !== "Tab") return;
  const items = focusables(event.currentTarget);
  if (items.length === 0) {
    event.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !event.currentTarget.contains(active) || active === event.currentTarget.querySelector("[data-dialog-heading]"))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !event.currentTarget.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}
