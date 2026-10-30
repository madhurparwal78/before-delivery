// Keyboard-complete dialogs (adapted from the kit's a11y_dialog module): focus moves in, Tab and Shift+Tab
// stay inside, Escape closes, and focus returns to the opener.

const FOCUSABLE = "button, input:not([type=hidden]), select, textarea, a[href], [tabindex]";

export function focusables(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) =>
    !el.hasAttribute("disabled") && el.tabIndex >= 0 && !el.closest("[hidden], [inert]")
    && el.getClientRects().length > 0);
}

/** Keeps Tab inside `root`. Returns the listener so callers can remove it. */
export function trapTab(root: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== "Tab") return;
  const items = focusables(root);
  if (!items.length) {
    event.preventDefault();
    return;
  }
  const first = items[0] as HTMLElement;
  const last = items[items.length - 1] as HTMLElement;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !root.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !root.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

export interface OpenDialog {
  close: () => void;
  element: HTMLElement;
}

/**
 * Shows a modal dialog built by `build` over the page. `opener` gets focus back on close.
 * The page behind is made inert while the dialog is open.
 */
export function openDialog(label: string, opener: HTMLElement, build: (close: () => void) => Node[],
  onClose?: () => void): OpenDialog {
  const shell = document.getElementById("app") as HTMLElement;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const dialog = document.createElement("div");
  dialog.className = "modal";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", label);
  let open = true;
  const close = (): void => {
    if (!open) return;
    open = false;
    document.removeEventListener("keydown", onKey, true);
    backdrop.remove();
    shell.inert = false;
    if (opener.isConnected) opener.focus();
    onClose?.();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else trapTab(dialog, event);
  };
  dialog.append(...build(close));
  backdrop.append(dialog);
  document.body.append(backdrop);
  shell.inert = true;
  document.addEventListener("keydown", onKey, true);
  (focusables(dialog)[0] ?? dialog).focus();
  return { close, element: dialog };
}
