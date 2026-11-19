// Modal dialogs (adapted from kit/modules/a11y_dialog): focus starts in the first field, Tab and Shift Tab cycle
// inside, Escape closes, and focus returns to the opener. The overlay keeps pointer input off the page behind.
import { useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]";

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) =>
    el.tabIndex >= 0 && !el.closest("[inert]") && el.getClientRects().length > 0);
}

interface Props {
  title: string;
  role?: "dialog" | "alertdialog";
  className?: string;
  onClose: () => void;
  /** Where focus starts; defaults to the first focusable element. */
  initialFocus?: () => HTMLElement | null;
  children: ReactNode;
  hideTitle?: boolean;
  describedBy?: string;
}

export function Dialog({ title, role = "dialog", className = "", onClose, initialFocus, children, hideTitle, describedBy }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = ref.current;
    if (panel) (initialFocus?.() ?? focusables(panel)[0] ?? panel).focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []); // focus moves once, when the dialog opens

  const onKeyDown = (event: React.KeyboardEvent) => {
    const panel = ref.current;
    if (!panel) return;
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      event.stopPropagation();
      close.current();
    } else if (event.key === "Tab") {
      const items = focusables(panel);
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0], last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first?.focus();
      }
    }
  };

  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close.current()}>
      <div ref={ref} role={role} aria-modal="true" aria-labelledby={titleId} aria-describedby={describedBy}
        className={`dialog ${className}`} tabIndex={-1} onKeyDown={onKeyDown}>
        <h2 id={titleId} className={hideTitle ? "visually-hidden" : "dialog-title"}>{title}</h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
