import { type KeyboardEvent, type ReactNode, useEffect, useRef } from "react";

// Modal dialog on the native <dialog>: focus moves in, Tab and Shift+Tab cycle inside, Escape
// closes, and focus returns to the control that opened it. Adapted from kit/modules/a11y_dialog.

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => !e.closest("[hidden]") && e.getClientRects().length > 0);
}

export function Dialog({
  title,
  open,
  onClose,
  children,
  initialFocus,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  initialFocus?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = `dialog-${title.toLowerCase().replace(/\W+/g, "-")}`;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      const first = initialFocus ? dialog.querySelector<HTMLElement>(initialFocus) : focusables(dialog)[0];
      (first ?? dialog).focus();
    } else if (!open && dialog.open) {
      dialog.close();
      opener.current?.focus();
    }
  }, [open, initialFocus]);

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>): void => {
    if (event.key !== "Tab" || !ref.current) return;
    const items = focusables(ref.current);
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && (document.activeElement === first || !ref.current.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !ref.current.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id={titleId} className="dialog-title">
        {title}
      </h2>
      {open ? children : null}
    </dialog>
  );
}
