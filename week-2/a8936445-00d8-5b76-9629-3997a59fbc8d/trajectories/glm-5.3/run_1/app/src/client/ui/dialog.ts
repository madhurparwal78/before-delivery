/** A focus-trapped dialog: focus on open, Tab inside, Escape or Cancel closes, focus returns. */

export interface DialogHandle {
  close(): void;
}

export function openDialog(options: {
  label: string;
  build: (root: HTMLElement, close: () => void) => void;
  onClose?: () => void;
}): DialogHandle {
  const dialog = document.createElement("dialog");
  dialog.className = "sheet";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", options.label);
  const inner = document.createElement("div");
  dialog.appendChild(inner);
  document.body.appendChild(dialog);

  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let closed = false;

  const close = (): void => {
    if (closed) return;
    closed = true;
    dialog.close();
  };

  dialog.addEventListener("close", () => {
    document.removeEventListener("keydown", onKeydown, true);
    dialog.remove();
    options.onClose?.();
    if (opener !== null && document.contains(opener)) {
      opener.focus();
    }
  });

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "Tab") {
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !("disabled" in el && (el as HTMLButtonElement).disabled) && el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey) {
        if (document.activeElement === first || !dialog.contains(document.activeElement)) {
          event.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last || !dialog.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener("keydown", onKeydown, true);

  options.build(inner, close);
  dialog.showModal();

  // Focus the first field, or the first button when there is no field.
  const firstField = inner.querySelector<HTMLElement>("input, select, textarea");
  const firstButton = inner.querySelector<HTMLElement>("button");
  (firstField ?? firstButton)?.focus();
  return { close };
}
