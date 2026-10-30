// Modal dialogs, adapted from kit/modules/a11y_dialog: focus moves to the first field, Tab and
// Shift+Tab stay inside, Escape closes, and focus returns to the control that opened it.
import { type KeyboardEvent, type ReactNode, useId, useLayoutEffect, useRef } from "react";

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
}

export function Dialog({
  title,
  onClose,
  children,
  role = "dialog",
  className = "",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  role?: "dialog" | "alertdialog";
  className?: string;
}): JSX.Element {
  const panel = useRef<HTMLDivElement>(null);
  const heading = useId();
  const returnTo = useRef<HTMLElement | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    returnTo.current = document.activeElement as HTMLElement | null;
    const el = panel.current as HTMLDivElement;
    const first = el.querySelector<HTMLElement>("[data-autofocus]") ?? focusables(el)[0];
    (first ?? el).focus();
    const outside = (e: FocusEvent): void => {
      if (e.target instanceof Node && !el.contains(e.target)) focusables(el)[0]?.focus();
    };
    const escape = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close.current();
    };
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
      const back = returnTo.current;
      if (back?.isConnected) back.focus();
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== "Tab") return;
    const items = focusables(panel.current as HTMLDivElement);
    if (!items.length) {
      e.preventDefault();
      return;
    }
    const edge = e.shiftKey ? items[0] : items[items.length - 1];
    if (document.activeElement === edge) {
      e.preventDefault();
      (e.shiftKey ? items[items.length - 1] : items[0]).focus();
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} className={`dialog ${className}`} role={role} aria-modal="true" aria-labelledby={heading} tabIndex={-1} onKeyDown={onKeyDown}>
        <h2 id={heading} className="dialog-title">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
