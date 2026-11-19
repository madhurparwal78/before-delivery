const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([type="hidden"]), a[href], [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.offsetParent !== null || element === document.activeElement);
}

/**
 * Opens a native modal `<dialog>`, wraps Tab and Shift+Tab inside it, closes on Escape and returns focus
 * to the control that opened it. Returns a disposer for when the owner unmounts. Adapted from the kit's
 * a11y_dialog module.
 */
export function openDialog(dialog: HTMLDialogElement, opener: HTMLElement | null, onClose: () => void): () => void {
  const returnTo = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  if (!dialog.open) dialog.showModal();
  let closed = false;
  const dispose = () => {
    closed = true;
    dialog.removeEventListener("keydown", onKey);
    dialog.removeEventListener("cancel", onCancel);
    if (dialog.open) dialog.close();
  };
  const close = () => {
    if (closed) return;
    dispose();
    returnTo?.focus();
    onClose();
  };
  const onCancel = (event: Event) => {
    event.preventDefault();
    close();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Tab") return;
    const items = focusables(dialog);
    const first = items[0];
    const last = items[items.length - 1];
    if (first === undefined || last === undefined) {
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
  };
  dialog.addEventListener("keydown", onKey);
  dialog.addEventListener("cancel", onCancel);
  return dispose;
}
