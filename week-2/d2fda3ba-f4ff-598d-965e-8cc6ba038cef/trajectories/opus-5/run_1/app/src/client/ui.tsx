import { useEffect, useRef, type JSX, type ReactNode } from 'react';
import { useSyncExternalStore } from 'react';
import { store, type AppState } from './state';

export function useCairn(): AppState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  name: string;
  onClose: () => void;
  children: ReactNode;
  initialFocus?: 'first' | 'none';
}

/** Open dialogs, innermost last, so Escape only closes the topmost one. */
const dialogStack: object[] = [];

/** A modal dialog that keeps Tab inside itself and returns focus when it closes. */

export function Dialog({ name, onClose, children, initialFocus = 'first' }: DialogProps): JSX.Element {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const token = useRef({});
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    opener.current = document.activeElement;
    const self = token.current;
    dialogStack.push(self);
    if (initialFocus === 'first') {
      panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    }

    const isTopmost = (): boolean => dialogStack[dialogStack.length - 1] === self;
    const onWindowKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && isTopmost()) {
        event.preventDefault();
        close.current();
      }
    };
    const onFocusIn = (event: FocusEvent): void => {
      if (!isTopmost() || !panel.current) return;
      const target = event.target;
      if (target instanceof Node && panel.current.contains(target)) return;
      panel.current.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    };
    window.addEventListener('keydown', onWindowKeyDown);
    document.addEventListener('focusin', onFocusIn);

    return () => {
      window.removeEventListener('keydown', onWindowKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      dialogStack.splice(dialogStack.indexOf(self), 1);
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [initialFocus]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="dialog-scrim">
      <div className="dialog" role="dialog" aria-modal="true" aria-label={name} ref={panel} onKeyDown={onKeyDown}>
        <h2 className="dialog-title">{name}</h2>
        {children}
      </div>
    </div>
  );
}

export interface ConfirmDialogProps {
  name: string;
  question: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  name,
  question,
  confirmLabel,
  onConfirm,
  onClose,
}: ConfirmDialogProps): JSX.Element {
  return (
    <Dialog name={name} onClose={onClose}>
      <p className="dialog-question">{question}</p>
      <div className="dialog-actions">
        <button type="button" className="primary" onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

export function useReducedMotion(): boolean {
  const query = useRef<MediaQueryList | null>(null);
  if (!query.current && typeof window.matchMedia === 'function') {
    query.current = window.matchMedia('(prefers-reduced-motion: reduce)');
  }
  return query.current?.matches ?? false;
}
