// Dialogs and alert dialogs: focus starts on the first field or primary button, Tab and Shift+Tab
// wrap inside, Escape closes, and focus returns to the opener unless the screen moves it (kit
// a11y_dialog contract, in React).

import { type KeyboardEvent, type ReactNode, useId, useLayoutEffect, useRef } from "react";

const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hidden && el.getClientRects().length > 0);
}

interface ModalProps {
  title: string;
  role?: "dialog" | "alertdialog";
  onClose: () => void;
  children: ReactNode;
  /** Shown under the title. */
  lede?: ReactNode;
}

export function Modal({ title, role = "dialog", onClose, children, lede }: ModalProps) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = panel.current;
    if (!root) return;
    (root.querySelector<HTMLElement>("[data-autofocus]") ?? focusables(root)[0] ?? root).focus();
    const keepInside = (event: FocusEvent): void => {
      if (event.target instanceof Node && !root.contains(event.target)) (focusables(root)[0] ?? root).focus();
    };
    document.addEventListener("focusin", keepInside);
    return () => {
      document.removeEventListener("focusin", keepInside);
      const active = document.activeElement;
      if (opener?.isConnected && (!active || active === document.body || root.contains(active))) opener.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
      return;
    }
    if (event.key !== "Tab" || !panel.current) return;
    const items = focusables(panel.current);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    if (event.shiftKey && (document.activeElement === first || !panel.current.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="modal-backdrop">
      <div ref={panel} className="modal" role={role} aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
        <h2 id={titleId} className="modal__title">
          {title}
        </h2>
        {lede}
        {children}
      </div>
    </div>
  );
}
