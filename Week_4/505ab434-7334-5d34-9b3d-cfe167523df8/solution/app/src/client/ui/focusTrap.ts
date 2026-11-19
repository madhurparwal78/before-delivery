// Keyboard-complete dialogs, adapted from kit/modules/a11y_dialog: focus the first field, keep Tab inside,
// close on Escape, give focus back to the opener.

function isFocusable(element: Element): boolean {
  if (element.hasAttribute("disabled") || element.hasAttribute("hidden") || element.hasAttribute("inert")) return false;
  if (element.closest("[hidden], [inert]")) return false;
  const tabindex = element.getAttribute("tabindex");
  if (tabindex !== null) return Number(tabindex) >= 0;
  const tag = element.tagName.toLowerCase();
  if (tag === "a") return element.hasAttribute("href");
  if (tag === "input") return element.getAttribute("type") !== "hidden";
  return ["button", "select", "textarea", "summary"].includes(tag);
}

/** Controls reachable with Tab inside the root, in document order. */
function focusables(root: Element): HTMLElement[] {
  return [...root.querySelectorAll("*")].filter(isFocusable) as HTMLElement[];
}

/** Opens a native dialog as modal; returns the function that closes it and restores focus. */
export function openDialog(dialog: HTMLDialogElement, opener: HTMLElement | null, onClose: () => void): () => void {
  dialog.showModal();
  const items = focusables(dialog);
  (items.find((el) => el.hasAttribute("autofocus")) ?? items[0] ?? dialog).focus();

  let open = true;
  const close = (): void => {
    if (!open) return;
    open = false;
    dialog.removeEventListener("keydown", onKey);
    dialog.removeEventListener("cancel", onCancel);
    if (dialog.open) dialog.close();
    if (opener?.isConnected) opener.focus();
    onClose();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") {
      const els = focusables(dialog);
      const active = document.activeElement;
      if (els.length === 0) return event.preventDefault();
      const edge = event.shiftKey ? els[0] : els[els.length - 1];
      if (active === edge || !dialog.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? els[els.length - 1] : els[0]).focus();
      }
    }
  };
  const onCancel = (event: Event): void => {
    event.preventDefault();
    close();
  };
  dialog.addEventListener("keydown", onKey);
  dialog.addEventListener("cancel", onCancel);
  return close;
}
