import { useEffect, useRef, type ReactNode, type RefObject } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => element.getClientRects().length > 0);
}

/**
 * Focus handling for dialogs and sheets: focus moves to the first control on open, Tab and Shift+Tab wrap,
 * Escape closes, and focus returns to the control that opened it.
 */
export function useDialog(active: boolean, onClose: () => void, panel: RefObject<HTMLElement | null>, opener?: RefObject<HTMLElement | null>): void {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const element = panel.current;
    if (!active || !element) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    focusables(element)[0]?.focus();
    function onKey(event: KeyboardEvent) {
      const root = panel.current;
      if (!root) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
      } else if (event.key === "Tab") {
        const items = focusables(root);
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) {
          event.preventDefault();
        } else if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    function onFocusIn(event: FocusEvent) {
      const root = panel.current;
      if (root && event.target instanceof Node && !root.contains(event.target)) focusables(root)[0]?.focus();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocusIn);
      (opener?.current ?? previous)?.focus();
    };
  }, [active, panel, opener]);
}

type Props = { title: string; open: boolean; onClose: () => void; opener?: RefObject<HTMLElement | null>; children: ReactNode };

/** A modal dialog with a scrim; it appears in place. */
export function Dialog({ title, open, onClose, opener, children }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  useDialog(open, onClose, panel, opener);
  if (!open) return null;
  return (
    <>
      <div className="scrim" aria-hidden="true" onClick={onClose} />
      <div ref={panel} className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </>
  );
}
