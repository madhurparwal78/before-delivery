// One dialog stack for every dialog, sheet and drawer: focus moves to the first control (or a
// named one), Tab stays inside, Escape closes the top one and focus returns to its opener.
import { focusables } from "./dom";

export interface OpenDialog {
  el: HTMLElement;
  opener: HTMLElement | null;
  /** Called on Escape; defaults to closing at once. */
  onEscape?: () => void;
  /** Called after the dialog leaves the stack. */
  onClose?: () => void;
  /** Sheets don't trap Tab: the page stays usable around them. */
  trap: boolean;
}

const stack: OpenDialog[] = [];

export function openDialog(d: Omit<OpenDialog, "trap"> & { trap?: boolean; focus?: HTMLElement | null }): OpenDialog {
  const entry: OpenDialog = { trap: true, ...d };
  stack.push(entry);
  const target = d.focus ?? focusables(d.el)[0] ?? d.el;
  if (target === d.el && !d.el.hasAttribute("tabindex")) d.el.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
  return entry;
}

/** Removes a dialog from the stack and returns focus to the control that opened it. */
export function closeDialog(entry: OpenDialog, returnFocus = true): void {
  const index = stack.indexOf(entry);
  if (index < 0) return;
  stack.splice(index, 1);
  entry.onClose?.();
  if (returnFocus && entry.opener?.isConnected) entry.opener.focus({ preventScroll: true });
}

const topDialog = (): OpenDialog | undefined => stack.at(-1);
export const isOpen = (entry: OpenDialog | null | undefined): boolean => !!entry && stack.includes(entry);
export const anyModalOpen = (): boolean => stack.some((d) => d.trap);

document.addEventListener(
  "keydown",
  (event) => {
    const top = topDialog();
    if (!top) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (top.onEscape) top.onEscape();
      else closeDialog(top);
      return;
    }
    if (event.key !== "Tab" || !top.trap) return;
    const items = focusables(top.el);
    if (!items.length) {
      event.preventDefault();
      return;
    }
    const first = items[0]!;
    const last = items.at(-1)!;
    const active = document.activeElement as HTMLElement | null;
    const inside = active && top.el.contains(active);
    if (!inside) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  },
  true,
);
