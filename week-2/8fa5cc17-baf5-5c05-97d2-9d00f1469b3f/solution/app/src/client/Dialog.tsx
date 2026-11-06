// Modal dialogs: focus kept inside, Escape closes, focus returns to the control that opened it.
import { useEffect, useLayoutEffect, useRef, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';

export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => e.tabIndex >= 0 && e.getClientRects().length > 0);
}

/** Tab from the last control goes to the first, Shift+Tab from the first to the last. */
export function trapTab(e: ReactKeyboardEvent | KeyboardEvent, root: HTMLElement): void {
  if (e.key !== 'Tab') return;
  const items = focusables(root);
  if (!items.length) {
    e.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !root.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !root.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}

interface DialogProps {
  label: string;
  role?: 'dialog' | 'alertdialog';
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** element focused when the dialog opens; defaults to the first control */
  initialFocus?: () => HTMLElement | null;
  /** where focus goes on close; defaults to the element focused when it opened */
  returnFocus?: () => HTMLElement | null;
  describedBy?: string;
}

export function Dialog({ label, role = 'dialog', onClose, children, className, initialFocus, returnFocus, describedBy }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const back = useRef(returnFocus);
  back.current = returnFocus;

  useLayoutEffect(() => {
    opener.current = document.activeElement;
    const root = ref.current;
    if (!root) return;
    (initialFocus?.() ?? focusables(root)[0] ?? root).focus();
    return () => {
      const target = back.current?.() ?? (opener.current instanceof HTMLElement ? opener.current : null);
      if (target && target.isConnected) target.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && ref.current && ref.current.contains(document.activeElement)) {
        e.preventDefault();
        e.stopPropagation();
        close.current();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  return createPortal(
    <div className="dialog-layer">
      <div
        ref={ref} role={role} aria-modal="true" aria-label={label} aria-describedby={describedBy} tabIndex={-1}
        className={`dialog ${className ?? ''}`} onKeyDown={(e) => ref.current && trapTab(e, ref.current)}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
