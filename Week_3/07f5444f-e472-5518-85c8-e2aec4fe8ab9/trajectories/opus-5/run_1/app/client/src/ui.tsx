import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const listener = (): void => setReduced(query.matches);
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, []);
  return reduced;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableInside(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.offsetParent !== null || element === document.activeElement,
  );
}

export interface ModalProps {
  name: string;
  onClose: () => void;
  children: ReactNode;
  variant?: 'dialog' | 'drawer';
}

/**
 * A modal dialog or drawer: focus starts inside, Tab and Shift+Tab stay inside, Escape
 * closes and focus returns to the control that opened it.
 */
export function Modal({ name, onClose, children, variant = 'dialog' }: ModalProps): JSX.Element {
  const panel = useRef<HTMLDivElement | null>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    const container = panel.current;
    if (container) {
      const fields = focusableInside(container);
      const first =
        fields.find((element) => element.matches('input, select, textarea')) ?? fields[0] ?? container;
      first.focus();
    }
    return () => {
      const previous = opener.current;
      if (previous instanceof HTMLElement && document.contains(previous)) previous.focus();
    };
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const container = panel.current;
      if (!container) return;
      const fields = focusableInside(container);
      if (fields.length === 0) return;
      const first = fields[0];
      const last = fields[fields.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === container)) {
        event.preventDefault();
        last.focus();
        return;
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  return (
    <div className={`scrim scrim-${variant}`}>
      <div
        className={`modal modal-${variant}`}
        role="dialog"
        aria-modal="true"
        aria-label={name}
        ref={panel}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  );
}

export function useInterval(callback: () => void, milliseconds: number): void {
  const latest = useRef(callback);
  latest.current = callback;
  useEffect(() => {
    const timer = setInterval(() => latest.current(), milliseconds);
    return () => clearInterval(timer);
  }, [milliseconds]);
}

export function useVisibilityReturn(callback: () => void): void {
  const latest = useRef(callback);
  latest.current = callback;
  useEffect(() => {
    const listener = (): void => {
      if (document.visibilityState === 'visible') latest.current();
    };
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  }, []);
}
