// Keyboard-complete dialogs (a TypeScript port of kit/modules/a11y_dialog): showModal, Tab and Shift+Tab
// wrap inside, Escape closes, and focus returns to the opener or to the control named on close.

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href], [tabindex]")].filter(
    (el) => !el.hasAttribute("disabled") && el.getAttribute("tabindex") !== "-1" && !el.closest("[hidden]") && el.getClientRects().length > 0,
  );
}

export function openDialog(dialog: HTMLDialogElement, opener: HTMLElement | null, first?: HTMLElement | null, onClose?: () => void) {
  document.body.append(dialog);
  dialog.showModal();
  (first ?? focusables(dialog)[0] ?? dialog).focus();
  let open = true;

  /** Closes the dialog; focus goes to `focusTo`, else back to the opener. */
  const close = (focusTo?: HTMLElement | null) => {
    if (!open) return;
    open = false;
    dialog.close();
    dialog.remove();
    const target = focusTo ?? opener;
    if (target?.isConnected) target.focus();
    onClose?.();
  };

  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") {
      const items = focusables(dialog);
      if (!items.length) return event.preventDefault();
      const active = document.activeElement;
      const edge = event.shiftKey ? items[0] : items[items.length - 1];
      if (active === edge || !dialog.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? items[items.length - 1] : items[0]).focus();
      }
    }
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  return { dialog, close };
}

export type OpenDialog = ReturnType<typeof openDialog>;
