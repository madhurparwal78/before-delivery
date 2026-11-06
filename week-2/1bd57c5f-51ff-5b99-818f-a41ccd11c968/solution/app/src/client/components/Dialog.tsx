import { useEffect, useId, useRef, type ReactNode } from "react";
import { useRetractError } from "../activity";
import { DIALOG_MS, EASE, reducedMotion } from "../motion";

// A modal dialog on the native <dialog>: focus moves inside, Tab and Shift+Tab cycle within
// it, Escape closes it, and focus returns to the control that opened it.
// Adapted from kit/modules/a11y_dialog (openDialog, focusables).

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => !element.closest("[inert]") && element.offsetParent !== null);
}

/** Keeps Tab and Shift+Tab inside `root`. */
export function trapTab(event: React.KeyboardEvent<HTMLElement>, root: HTMLElement): void {
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

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Dialog({ open, title, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const retractError = useRetractError();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    opener.current = document.activeElement as HTMLElement | null;
    dialog.showModal();
    if (!reducedMotion()) dialog.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DIALOG_MS, easing: EASE });
    focusables(dialog)[0]?.focus();
    return () => {
      dialog.close();
      opener.current?.focus();
      retractError();
    };
  }, [open, retractError]);

  if (!open) return null;
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        } else if (ref.current) trapTab(event, ref.current);
      }}
    >
      <div className="dialog-body">
        <div className="dialog-head">
          <h3 id={titleId}>{title}</h3>
        </div>
        {children}
      </div>
    </dialog>
  );
}
