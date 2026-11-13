const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])';

export interface DialogHandle {
  close(): void;
}

/**
 * Opens a modal dialog that keeps Tab inside it and returns focus to the control
 * that opened it, found again by selector so a live redraw cannot lose it.
 */
export function openDialog(
  dialog: HTMLDialogElement,
  openerSelector: string,
  options: { onClose?: () => void; initialFocus?: HTMLElement | null } = {},
): DialogHandle {
  document.body.append(dialog);

  const focusables = (): HTMLElement[] => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusables();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  function close(): void {
    dialog.removeEventListener("keydown", onKeyDown);
    if (dialog.open) dialog.close();
    dialog.remove();
    if (options.onClose !== undefined) options.onClose();
    const opener = document.querySelector<HTMLElement>(openerSelector);
    if (opener !== null) opener.focus();
  }

  dialog.addEventListener("keydown", onKeyDown);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.showModal();
  const initial = options.initialFocus ?? focusables()[0] ?? null;
  if (initial !== null) initial.focus();
  return { close };
}
