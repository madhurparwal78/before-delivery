import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { announce } from './live';

export type DialogProps = {
  label: string;
  open: boolean;
  onClose: () => void;
  closeBlocked?: boolean;
  children: ReactNode;
  onClosedFocusRef?: React.RefObject<HTMLElement | null>;
  fallbackFocusId?: string;
};

/** A modal dialog that traps Tab, closes on Escape (unless blocked) and restores focus. */
export function Dialog({ label, open, onClose, closeBlocked, children, onClosedFocusRef, fallbackFocusId }: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement;
    const first = findFocusable(dialogRef.current);
    if (first) first.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!closeBlocked) {
          event.preventDefault();
          close();
        }
        return;
      }
      if (event.key !== 'Tab') return;
      const focusables = findFocusables(dialogRef.current);
      if (focusables.length === 0) return;
      const firstEl = focusables[0];
      const lastEl = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === firstEl) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.querySelectorAll<HTMLElement>('main, header, footer, nav').forEach((el) => {
      el.setAttribute('inert', '');
    });
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      document.querySelectorAll<HTMLElement>('[inert]').forEach((el) => el.removeAttribute('inert'));
    };
  }, [open, closeBlocked]);

  const close = () => {
    onClose();
    window.setTimeout(() => {
      const opener = onClosedFocusRef?.current;
      const target =
        (opener && document.contains(opener) ? opener : null) ??
        (fallbackFocusId ? document.getElementById(fallbackFocusId) : null) ??
        openerRef.current;
      if (target instanceof HTMLElement) {
        target.focus();
      }
    }, 0);
  };

  if (!open) return null;
  return createPortal(
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !closeBlocked) close();
      }}
    >
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={label} className="dialog-panel">
        {children}
      </div>
    </div>,
    document.body,
  );
}

function findFocusables(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  const nodes = root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  return [...nodes].filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
}

function findFocusable(root: HTMLElement | null): HTMLElement | null {
  return findFocusables(root)[0] ?? null;
}

export { announce };
