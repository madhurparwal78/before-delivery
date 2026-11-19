import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute("hidden") && el.getAttribute("aria-hidden") !== "true" && el.closest("[inert]") === null);
}

/**
 * A modal dialog or bottom sheet. Tab and Shift+Tab wrap inside it, Escape and the backdrop close it, focus goes to
 * the first control (or `initialFocus`) and returns to the opener on close. Closed dialogs are not rendered at all.
 */
export function Modal({
  label,
  onClose,
  children,
  sheet = false,
  initialFocus,
  className = "",
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  sheet?: boolean;
  initialFocus?: string;
  className?: string;
}): JSX.Element {
  const panel = useRef<HTMLDivElement>(null);
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const node = panel.current!;
    const target = (initialFocus ? node.querySelector<HTMLElement>(initialFocus) : null) ?? focusables(node)[0] ?? node;
    target.focus();
    const root = document.getElementById("root");
    root?.setAttribute("inert", "");
    return () => {
      root?.removeAttribute("inert");
      if (opener && opener.isConnected) opener.focus();
    };
  }, [initialFocus, opener]);

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.stopPropagation();
      event.preventDefault();
      close.current();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusables(panel.current!);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !panel.current!.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !panel.current!.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className={`overlay ${sheet ? "overlay-sheet" : ""}`} onMouseDown={(event) => event.target === event.currentTarget && close.current()}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className={`dialog ${sheet ? "sheet" : ""} ${className}`} onKeyDown={onKeyDown}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
