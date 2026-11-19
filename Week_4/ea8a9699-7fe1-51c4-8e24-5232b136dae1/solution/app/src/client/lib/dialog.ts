// Modal dialogs (adapted from kit/modules/a11y_dialog): showModal, first or [autofocus] field focused, Tab and
// Shift+Tab kept inside, Escape closes, focus returns to the opener.
import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = "button, input:not([type=hidden]), select, textarea, a[href], [tabindex]";

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.hasAttribute("disabled") && el.tabIndex >= 0 && !el.closest("[hidden],[inert]") && el.getClientRects().length > 0,
  );
}

/** Keeps focus inside `root` on Tab. */
function trapTab(event: KeyboardEvent | React.KeyboardEvent, root: HTMLElement): void {
  if (event.key !== "Tab") return;
  const items = focusables(root);
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) {
    event.preventDefault();
    return;
  }
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !root.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !root.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

/** Opens `<dialog>` as a modal while `open`; `onClose` runs on Escape. Focus returns to `opener` on close. */
export function useModal(open: boolean, onClose: () => void, opener: RefObject<HTMLElement | null>): RefObject<HTMLDialogElement | null> {
  const ref = useRef<HTMLDialogElement | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const returnTo = opener.current;
    if (!dialog.open) dialog.showModal();
    const items = focusables(dialog);
    (items.find((el) => el.hasAttribute("data-autofocus")) ?? items[0] ?? dialog).focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
      } else trapTab(event, dialog);
    };
    const onCancel = (event: Event): void => {
      event.preventDefault();
      close.current();
    };
    dialog.addEventListener("keydown", onKey);
    dialog.addEventListener("cancel", onCancel);
    return () => {
      dialog.removeEventListener("keydown", onKey);
      dialog.removeEventListener("cancel", onCancel);
      if (dialog.open) dialog.close();
      if (returnTo?.isConnected) returnTo.focus();
    };
  }, [open, opener]);
  return ref;
}
