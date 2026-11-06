/** Keyboard-complete modal dialogs (adapted from the kit's a11y_dialog module): Tab never leaves an open dialog. */

const FOCUSABLE =
  "a[href], button:not([disabled]), input:not([disabled]):not([type='hidden']), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

/** The dialog's Tab stops in document order, leaving out anything hidden. */
function focusables(dialog: Element) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => !element.closest("[hidden]"));
}

/** On Tab at the last stop, or Shift+Tab at the first, wraps focus to the other end of the dialog. */
export function keepTabInside(dialog: Element, event: Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault">) {
  if (event.key !== "Tab") return;
  const stops = focusables(dialog);
  if (!stops.length) return;
  const edge = event.shiftKey ? stops[0] : stops[stops.length - 1];
  const active = dialog.ownerDocument.activeElement;
  if (active === edge || !dialog.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? stops[stops.length - 1] : stops[0]).focus();
  }
}
