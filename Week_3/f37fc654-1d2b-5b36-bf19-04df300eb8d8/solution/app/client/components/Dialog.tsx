// Dialogs, drawers and sheets: Tab and Shift+Tab cycle inside, Escape closes, focus returns to the
// opener. Closed dialogs are unmounted, so nothing inside them can be seen or reached.
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest("[hidden]") && el.offsetParent !== null);
}

interface Props {
  label: string;
  labelledBy?: string;
  className?: string;
  onClose: () => void;
  initialFocus?: string;
  children: ReactNode;
}

export function Dialog({ label, labelledBy, className, onClose, initialFocus, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = ref.current;
    if (root) {
      const first = (initialFocus && root.querySelector<HTMLElement>(initialFocus)) || focusables(root)[0] || root;
      first.focus();
    }
    return () => opener?.focus();
  }, [initialFocus]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close.current();
      return;
    }
    if (event.key !== "Tab" || !ref.current) return;
    const items = focusables(ref.current);
    if (!items.length) {
      event.preventDefault();
      return;
    }
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey && at <= 0) {
      event.preventDefault();
      items[items.length - 1].focus();
    } else if (!event.shiftKey && at === items.length - 1) {
      event.preventDefault();
      items[0].focus();
    }
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      tabIndex={-1}
      className={className}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}
