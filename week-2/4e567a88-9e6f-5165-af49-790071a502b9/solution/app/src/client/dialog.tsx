// Keyboard-complete dialogs on native <dialog> (adapted from kit a11y_dialog): Tab and Shift+Tab stay
// inside, Escape closes, and focus returns to the control that opened the dialog.

import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { EASE, SHORT_MS, reducedMotion } from "./hooks";
import { Icon } from "./icons";

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(
    "a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])",
  )].filter((el) => !el.hasAttribute("disabled") && el.getClientRects().length > 0);
}

let titles = 0;

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  role?: "dialog" | "alertdialog";
  /** Selector of the element focused on open; the first focusable otherwise. */
  initialFocus?: string;
  /** Where focus goes on close; the opener when this returns null. */
  returnFocusTo?: () => HTMLElement | null;
  /** Show the visible title bar with a Close button. */
  closable?: boolean;
  wide?: boolean;
}

export function Dialog(props: DialogProps) {
  const { open, title, onClose, children, role = "dialog", initialFocus, closable = true, wide = false } = props;
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useRef(`dialog-title-${++titles}`);
  const latest = useRef(props);
  latest.current = props;
  // Content stays while the dialog fades out, and is dropped once it has closed.
  const kept = useRef<ComponentChildren>(null);
  const [, setClosed] = useState(0);
  if (open) kept.current = children;

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      const target = (initialFocus && dialog.querySelector<HTMLElement>(initialFocus)) || focusables(dialog)[0];
      target?.focus();
      if (!reducedMotion()) {
        dialog.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "translateY(0)" }],
          { duration: SHORT_MS, easing: EASE });
      }
    } else if (!open && dialog.open) {
      const finish = () => {
        dialog.close();
        kept.current = null;
        setClosed((n) => n + 1);
        const back = latest.current.returnFocusTo?.() ?? opener.current;
        if (back && back.isConnected) back.focus();
      };
      if (reducedMotion()) finish();
      else {
        dialog.animate([{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(6px)" }],
          { duration: SHORT_MS, easing: EASE }).finished.then(finish, finish);
      }
    }
  }, [open]);

  useEffect(() => () => {
    if (ref.current?.open) ref.current.close();
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    const dialog = ref.current;
    if (!dialog) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      latest.current.onClose();
    } else if (event.key === "Tab") {
      const items = focusables(dialog);
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <dialog ref={ref} class={`dialog${wide ? " dialog--wide" : ""}`} role={role === "alertdialog" ? "alertdialog" : undefined}
      aria-labelledby={titleId.current} onKeyDown={onKeyDown}
      onCancel={(event) => {
        event.preventDefault();
        latest.current.onClose();
      }}>
      <header class="dialog__head">
        <h2 id={titleId.current} class="dialog__title">{title}</h2>
        {closable && (
          <button type="button" class="btn btn--quiet btn--icon" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        )}
      </header>
      <div class="dialog__body">{kept.current}</div>
    </dialog>
  );
}
