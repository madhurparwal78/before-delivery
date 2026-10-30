import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const INERT_WHILE_OPEN = '[data-inert-when-dialog]';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

/**
 * Opens with focus on its first field (or its primary button), traps Tab, closes on
 * Escape and returns focus to the control that opened it.
 */
export function Dialog({ title, onClose, children }: DialogProps): ReactNode {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    const node = panel.current;
    if (node !== null) {
      const focusable = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const field = focusable.find((element) =>
        ['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName) && element.getAttribute('readonly') === null,
      );
      (field ?? focusable[0])?.focus();
    }
    const behind = [...document.querySelectorAll<HTMLElement>(INERT_WHILE_OPEN)];
    for (const element of behind) element.setAttribute('inert', '');
    return () => {
      for (const element of behind) element.removeAttribute('inert');
      const previous = opener.current;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const node = panel.current;
      if (node === null) return;
      const focusable = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  return createPortal(
    <div className="scrim">
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} ref={panel}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
