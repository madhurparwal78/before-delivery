import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { usePrefersReducedMotion } from '../app-state';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

export function Dialog({
  label,
  onClose,
  children,
  role = 'dialog',
  describedBy,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  role?: 'dialog' | 'alertdialog';
  describedBy?: string;
}): JSX.Element {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    opener.current = document.activeElement;
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => {
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || panel.current === null) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (item) => item.offsetParent !== null || item === document.activeElement,
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  return (
    <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={panel}
        role={role}
        aria-modal="true"
        aria-label={label}
        aria-describedby={describedBy}
        className={reduced ? 'dialog' : 'dialog dialog-enter'}
      >
        {children}
      </div>
    </div>
  );
}

export function FieldError({ id, message }: { id: string; message: string | undefined }): JSX.Element | null {
  if (message === undefined || message === '') return null;
  return (
    <p className="field-error" id={id}>
      {message}
    </p>
  );
}
