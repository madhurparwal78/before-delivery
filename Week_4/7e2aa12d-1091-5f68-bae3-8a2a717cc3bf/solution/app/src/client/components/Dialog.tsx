import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { play } from '../lib/motion.js';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

interface DialogProps {
  label: string;
  onClose: () => void;
  /** A drawer slides in from the right edge and out again. */
  drawer?: boolean;
  /** Where focus goes on close; the control focused when the dialog opened by default. */
  returnFocus?: () => HTMLElement | null;
  /** The content, given the function that closes the dialog (with its exit motion). */
  children: (close: () => void) => ReactNode;
}

/** A modal `<dialog>`: Tab and Shift+Tab wrap inside it, Escape closes it, and focus goes back to where it came from. */
export function Dialog({ label, onClose, drawer = false, returnFocus, children }: DialogProps) {
  const element = useRef<HTMLDialogElement>(null);
  const leaving = useRef(false);
  const focusTarget = useRef(returnFocus);
  focusTarget.current = returnFocus;

  useLayoutEffect(() => {
    const dialog = element.current as HTMLDialogElement;
    const opener = document.activeElement as HTMLElement | null;
    dialog.showModal();
    if (drawer) play(dialog, 'drawer', [{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }]);
    (dialog.querySelector<HTMLElement>('[data-autofocus]') ?? dialog.querySelector<HTMLElement>(FOCUSABLE) ?? dialog).focus();
    return () => {
      dialog.close();
      (focusTarget.current?.() ?? opener)?.focus();
    };
  }, []);

  const close = (): void => {
    if (leaving.current) return;
    leaving.current = true;
    if (drawer && element.current) play(element.current, 'drawer', [{ transform: 'translateX(0)' }, { transform: 'translateX(100%)' }], onClose);
    else onClose();
  };

  const keys = (event: KeyboardEvent<HTMLDialogElement>): void => {
    const dialog = element.current as HTMLDialogElement;
    if (!dialog.contains(event.target as Node)) return;
    // Escape is handled here, not by the native cancel event: closing a dialog while the browser is still
    // dispatching `cancel` makes it send a second cancel to the dialog underneath.
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const stops = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((stop) => stop.getClientRects().length > 0);
    if (stops.length === 0) return;
    const first = stops[0];
    const last = stops[stops.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <dialog
      ref={element}
      aria-label={label}
      className={drawer ? 'dialog drawer' : 'dialog'}
      onKeyDown={keys}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      {children(close)}
    </dialog>,
    document.body,
  );
}
