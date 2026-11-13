// Dialogs and sheets on the native <dialog> (adapted from kit/modules/a11y_dialog): focus moves
// in on open, Tab and Shift+Tab wrap inside, Escape closes, focus returns to the opener. A closed
// dialog is `display: none` at once, so nothing in it is visible, tabbable or in the tree.

import { useLayoutEffect, useRef, type ReactNode } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A radio group is one tab stop: its checked radio, or its first when none is checked. */
function isTabStop(el: HTMLElement): boolean {
  if (!(el instanceof HTMLInputElement) || el.type !== "radio" || !el.name) return true;
  const group = [...(el.form ?? el.ownerDocument).querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(el.name)}"]:not([disabled])`)];
  return el.checked || (!group.some((r) => r.checked) && group[0] === el);
}

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0 && isTabStop(el));
}

interface DialogProps {
  open: boolean;
  label: string;
  onClose: () => void;
  children: ReactNode;
  variant?: "panel" | "sheet";
  /** Where focus goes after closing; defaults to the element focused when the dialog opened. */
  returnFocus?: () => HTMLElement | null;
  /** Bumped by the caller to move focus to `[data-dialog-focus]` (e.g. a success heading). */
  focusKey?: number;
}

export function Dialog({ open, label, onClose, children, variant = "panel", returnFocus, focusKey }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const returnTo = useRef(returnFocus);
  returnTo.current = returnFocus;

  useLayoutEffect(() => {
    const dialog = ref.current as HTMLDialogElement;
    if (open && !dialog.open) {
      opener.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
      const first = dialog.querySelector<HTMLElement>("[data-autofocus]") ?? focusables(dialog)[0] ?? dialog;
      first.focus();
    } else if (!open && dialog.open) {
      dialog.close();
      (returnTo.current?.() ?? opener.current)?.focus();
    }
  }, [open]);

  useLayoutEffect(() => {
    if (open && focusKey) ref.current?.querySelector<HTMLElement>("[data-dialog-focus]")?.focus();
  }, [open, focusKey]);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      className={`dialog dialog-${variant}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const items = focusables(event.currentTarget);
        if (!items.length) return event.preventDefault();
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && (active === first || !event.currentTarget.contains(active))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (active === last || !event.currentTarget.contains(active))) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      {open && (
        <div className="dialog-body">
          {children}
          <button type="button" className="dialog-close" aria-label={`Close ${label}`} onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      )}
    </dialog>
  );
}
