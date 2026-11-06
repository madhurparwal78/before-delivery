// A modal dialog: showModal(), focus on open, Tab and Shift+Tab wrap inside, Escape closes.
// Adapted from kit/modules/a11y_dialog for React.

import { useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";

const FOCUSABLE = "button:not([disabled]), a[href], input:not([disabled]):not([type=hidden]), select:not([disabled]), [tabindex]:not([tabindex='-1'])";

interface DialogProps {
  open: boolean;
  title: string;
  /** Escape or Cancel; not called while `locked`. */
  onDismiss: () => void;
  initialFocus: RefObject<HTMLElement | null>;
  /** Where focus returns when the dialog closes; null when the caller moves focus itself. */
  returnFocus: RefObject<HTMLElement | null> | null;
  locked?: boolean;
  className?: string;
  children: ReactNode;
}

export function Dialog({ open, title, onDismiss, initialFocus, returnFocus, locked = false, className = "", children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useLayoutEffect(() => {
    const dialog = ref.current!;
    if (open && !dialog.open) {
      dialog.showModal();
      initialFocus.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
      returnFocus?.current?.focus();
    }
  }, [open, initialFocus, returnFocus]);

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;
    const items = [...ref.current!.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return event.preventDefault();
    const first = items[0]!, last = items[items.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !ref.current!.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !ref.current!.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`dialog ${className}`}
      onKeyDown={onKeyDown}
      onCancel={(event) => {
        event.preventDefault();
        if (!locked) onDismiss();
      }}
    >
      <h2 id={titleId} className="dialog-title">{title}</h2>
      {children}
    </dialog>
  );
}
