// Modal dialog, alert dialog and bottom sheet: keeps Tab inside, closes on Escape, returns focus (brief: Dialogs and sheets).
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE = 'a[href],button,input:not([type="hidden"]),select,textarea,summary,[tabindex]';

function focusables(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    if (el.hasAttribute('disabled') || el.hasAttribute('hidden') || el.closest('[inert],[hidden]')) return false;
    const tabindex = el.getAttribute('tabindex');
    if (tabindex !== null && Number(tabindex) < 0) return false;
    return el.getClientRects().length > 0;
  });
}

interface DialogProps {
  label: string;
  onClose: () => void;
  children: ReactNode;
  role?: 'dialog' | 'alertdialog';
  /** `sheet` slides up from the bottom edge (phones). */
  variant?: 'center' | 'sheet';
  /** Where focus goes on close; defaults to the element focused when the dialog opened. */
  returnFocus?: () => HTMLElement | null;
  /** Focus target on open; defaults to the first focusable control. */
  initialFocus?: (root: HTMLElement) => HTMLElement | null;
  className?: string;
}

export function Dialog({ label, onClose, children, role = 'dialog', variant = 'center', returnFocus, initialFocus, className }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const returnRef = useRef(returnFocus);
  returnRef.current = returnFocus;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.getElementById('root');
    root?.setAttribute('inert', '');
    const first = initialFocus?.(node) ?? focusables(node)[0] ?? node;
    first.focus();

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      } else if (event.key === 'Tab') {
        const items = focusables(node);
        if (items.length === 0) {
          event.preventDefault();
          return;
        }
        const active = document.activeElement;
        const edge = event.shiftKey ? items[0] : items[items.length - 1];
        if (active === edge || !node.contains(active)) {
          event.preventDefault();
          (event.shiftKey ? items[items.length - 1] : items[0])?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      root?.removeAttribute('inert');
      const target = returnRef.current?.() ?? opener;
      if (target?.isConnected) target.focus();
    };
  }, []);

  return createPortal(
    <div className={`overlay overlay-${variant}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={ref} role={role} aria-modal="true" aria-label={label} tabIndex={-1} className={`dialog dialog-${variant} ${className ?? ''}`}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
