import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { prefersReducedMotion } from "../hooks.js";

const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) =>
      !el.hasAttribute("disabled") &&
      !el.hasAttribute("hidden") &&
      el.getAttribute("type") !== "hidden" &&
      !(el instanceof HTMLInputElement && el.type === "radio" && !el.checked),
  );
}

interface DialogProps {
  title: string;
  /** The dialog's accessible name when it differs from the visible heading. */
  label?: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A modal `<dialog>`: focus goes to the first control, Tab and Shift+Tab wrap inside it, Escape closes it,
 * and focus returns to the control that opened it.
 */
export function Dialog({ title, label, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(document.activeElement);
  const [closing, setClosing] = useState(false);
  const heading = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    focusables(dialog)[0]?.focus();
    const from = opener.current;
    return () => {
      if (from instanceof HTMLElement && from.isConnected) from.focus();
    };
  }, []);

  const requestClose = (): void => {
    if (prefersReducedMotion()) onClose();
    else setClosing(true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      requestClose();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusables(event.currentTarget);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !event.currentTarget.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !event.currentTarget.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog
      ref={ref}
      className={closing ? "dialog closing" : "dialog"}
      aria-labelledby={label === undefined ? heading : undefined}
      aria-label={label}
      onKeyDown={onKeyDown}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onAnimationEnd={() => {
        if (closing) onClose();
      }}
    >
      <div className="dialog-body">
        <h2 id={heading} className="dialog-title">
          {title}
        </h2>
        {children}
      </div>
    </dialog>
  );
}
