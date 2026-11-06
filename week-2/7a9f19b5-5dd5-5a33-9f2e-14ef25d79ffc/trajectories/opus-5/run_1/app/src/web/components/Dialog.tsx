/**
 * Every dialog behaves the same way: opening moves focus to its first control,
 * Tab wraps at both ends, Escape closes it, closing returns focus to the control
 * that opened it, and the page behind cannot be focused or clicked.
 *
 * A closed dialog renders nothing at all, so its contents are not visible,
 * focusable or in the accessibility tree at any viewport.
 */

import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.offsetParent !== null || element === document.activeElement,
  );
}

export interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** `full` is the phone Menu dialog; `sheet` is the Filters bottom sheet. */
  variant?: "panel" | "full" | "sheet";
}

export function Dialog({ title, onClose, children, variant = "panel" }: DialogProps): ReactNode {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<Element | null>(null);
  const headingId = useId();

  // Remember the opener, then move focus to the dialog's first control.
  useEffect(() => {
    openerRef.current = document.activeElement;
    const panel = panelRef.current;
    if (panel) {
      const first = focusableWithin(panel)[0];
      (first ?? panel).focus();
    }
    return () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, []);

  /**
   * Escape is handled on the document, not only inside the panel: a control that
   * disables itself while it is working hands focus back to the body, and the
   * dialog must still close from the keyboard.
   */
  useEffect(() => {
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onEscape, true);
    return () => document.removeEventListener("keydown", onEscape, true);
  }, [onClose]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = focusableWithin(panel);
      if (items.length === 0) return;
      const first = items[0] as HTMLElement;
      const last = items[items.length - 1] as HTMLElement;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  const panelClass = variant === "full" ? "dialog dialog-full" : variant === "sheet" ? "dialog sheet" : "dialog";

  return (
    <div
      className="scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={panelClass}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        ref={panelRef}
        onKeyDown={onKeyDown}
      >
        <h2 id={headingId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}
