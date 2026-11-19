import { useLayoutEffect, useRef } from "react";

// Adapted from kit/modules/a11y_dialog: modal open, focus in, Tab kept inside, Escape closes, focus returns.
const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

function focusables(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter((el) => !el.closest("[hidden]") && el.getClientRects().length > 0);
}

export function useModal(open, onClose, initialFocus) {
  const ref = useRef(null);
  const opener = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return undefined;
    opener.current = document.activeElement;
    if (!dialog.open) dialog.showModal();
    (initialFocus?.current ?? focusables(dialog)[0] ?? dialog).focus();
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
      } else if (event.key === "Tab") {
        const items = focusables(dialog);
        if (!items.length) return event.preventDefault();
        const edge = event.shiftKey ? items[0] : items[items.length - 1];
        if (document.activeElement === edge || !dialog.contains(document.activeElement)) {
          event.preventDefault();
          (event.shiftKey ? items[items.length - 1] : items[0]).focus();
        }
      }
      return undefined;
    };
    const onCancel = (event) => {
      event.preventDefault();
      close.current();
    };
    dialog.addEventListener("keydown", onKey);
    dialog.addEventListener("cancel", onCancel);
    return () => {
      dialog.removeEventListener("keydown", onKey);
      dialog.removeEventListener("cancel", onCancel);
      if (dialog.open) dialog.close();
      opener.current?.focus?.();
    };
  }, [open, initialFocus]);

  return ref;
}
