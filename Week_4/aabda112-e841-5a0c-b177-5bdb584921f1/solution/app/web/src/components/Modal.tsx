import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Enabled controls reachable with Tab, in document order (adapted from kit/modules/a11y_dialog). */
function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]')].filter((el) => {
    if (el.hasAttribute('disabled') || el.closest('[inert],[hidden]')) return false;
    if (el instanceof HTMLInputElement && el.type === 'hidden') return false;
    const tabindex = el.getAttribute('tabindex');
    return tabindex === null || Number(tabindex) >= 0;
  });
}

let openDialogs = 0;

/**
 * A modal dialog. Focus moves to its first field, Tab and Shift+Tab stay inside it, the page behind is inert,
 * Escape closes it and focus returns to what opened it.
 */
export function Modal({ label, onClose, returnFocus, children, className = '' }: { label: string; onClose: () => void; returnFocus?: () => HTMLElement | null; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(document.activeElement);
  const close = useRef(onClose);
  close.current = onClose;
  const back = useRef(returnFocus);
  back.current = returnFocus;

  useLayoutEffect(() => {
    const root = document.getElementById('root');
    openDialogs++;
    root?.setAttribute('inert', '');
    const dialog = ref.current!;
    const first = dialog.querySelector<HTMLElement>('[autofocus]') ?? focusables(dialog)[0] ?? dialog;
    first.focus();
    return () => {
      openDialogs--;
      if (openDialogs === 0) root?.removeAttribute('inert');
      // Focus already moved on purpose (a new appointment, say): leave it there.
      const active = document.activeElement;
      if (active && active !== document.body && !dialog.contains(active)) return;
      const target = back.current?.() ?? (opener.current instanceof HTMLElement && opener.current.isConnected ? opener.current : null);
      target?.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close.current();
      return;
    }
    if (event.key !== 'Tab') return;
    const dialog = ref.current!;
    const items = focusables(dialog);
    const active = document.activeElement as HTMLElement | null;
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const last = items[items.length - 1]!;
    const within = active !== null && dialog.contains(active);
    const tabStop = active !== null && items.includes(active);
    if (event.shiftKey && (!within || !tabStop || active === items[0])) {
      // Shift+Tab from the first control, the error summary or the dialog itself must not leave the dialog.
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (!within || active === last)) {
      event.preventDefault();
      items[0]!.focus();
    }
  };

  return createPortal(
    <div className="modal-backdrop">
      <div ref={ref} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className={`modal ${className}`} onKeyDown={onKeyDown}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
