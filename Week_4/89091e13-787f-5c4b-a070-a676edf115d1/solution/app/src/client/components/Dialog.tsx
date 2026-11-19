import { useEffect, useRef, type ReactNode } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A modal dialog: focus moves in, Tab wraps, Escape closes and focus returns to the control that opened it. */
export function Dialog({ label, onClose, className = "", children }: {
  label: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = panel.current as HTMLDivElement;
    const focusables = () => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
    (root.querySelector<HTMLElement>("[autofocus]") ?? focusables()[0] ?? root).focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    const pullBack = (event: FocusEvent) => {
      if (event.target instanceof Node && !root.contains(event.target)) focusables()[0]?.focus();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", pullBack);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", pullBack);
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <div className="dialog-backdrop">
      <div ref={panel} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className={`dialog ${className}`.trim()}>
        {children}
      </div>
    </div>
  );
}
