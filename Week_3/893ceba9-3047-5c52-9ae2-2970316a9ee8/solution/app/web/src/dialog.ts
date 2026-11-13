// Keyboard-complete modal dialogs, adapted from the golden kit's a11y_dialog module:
// focus lands on the first control, Tab wraps inside, Escape closes, focus goes back to the opener.
// openDialog returns the function that closes the dialog.

function isFocusable(el: Element): boolean {
  if (el.hasAttribute("disabled") || el.hasAttribute("hidden") || el.hasAttribute("inert")) return false;
  const tabindex = el.getAttribute("tabindex");
  if (tabindex !== null) return Number(tabindex) >= 0;
  const tag = el.tagName.toLowerCase();
  if (tag === "a" || tag === "area") return el.hasAttribute("href");
  if (tag === "input") return el.getAttribute("type") !== "hidden";
  return ["button", "select", "textarea", "summary"].includes(tag);
}

function focusables(root: Element): HTMLElement[] {
  return [...root.querySelectorAll("*")].filter(isFocusable) as HTMLElement[];
}

export function openDialog(
  dialog: HTMLDialogElement,
  opener: HTMLElement | null,
  onClose: () => void,
  returnTo?: () => HTMLElement | null,
): () => void {
  const doc = dialog.ownerDocument;
  if (!dialog.open) dialog.showModal();
  const items = focusables(dialog);
  (items.find((el) => el.hasAttribute("autofocus")) ?? items[0] ?? dialog).focus();

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      const els = focusables(dialog);
      if (!els.length) return e.preventDefault();
      const edge = e.shiftKey ? els[0] : els[els.length - 1];
      if (doc.activeElement === edge || !dialog.contains(doc.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? els[els.length - 1] : els[0]).focus();
      }
    }
  };
  const onCancel = (e: Event) => {
    e.preventDefault();
    close();
  };
  let open = true;
  function close() {
    if (!open) return;
    open = false;
    dialog.removeEventListener("keydown", onKey);
    dialog.removeEventListener("cancel", onCancel);
    if (dialog.open) dialog.close();
    const target = returnTo?.() ?? opener;
    if (target && target.isConnected) target.focus();
    onClose();
  }
  dialog.addEventListener("keydown", onKey);
  dialog.addEventListener("cancel", onCancel);
  return close;
}
