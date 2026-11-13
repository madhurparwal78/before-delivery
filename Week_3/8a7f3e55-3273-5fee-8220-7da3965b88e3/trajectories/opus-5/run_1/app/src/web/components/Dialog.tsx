import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  title: string;
  onEscape: (() => void) | null;
  children: ReactNode;
  focusOnOpen?: () => HTMLElement | null;
}

export function Dialog({ title, onEscape, children, focusOnOpen }: DialogProps): ReactNode {
  const frame = useRef<HTMLDivElement | null>(null);
  const focusRequest = useRef(focusOnOpen);
  focusRequest.current = focusOnOpen;

  useEffect(() => {
    const requested = focusRequest.current?.() ?? null;
    if (requested !== null) {
      requested.focus();
      return;
    }
    const first = frame.current?.querySelector<HTMLElement>(FOCUSABLE) ?? null;
    first?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (onEscape !== null) {
        event.preventDefault();
        onEscape();
      }
      return;
    }
    if (event.key !== 'Tab') return;
    const frameNode = frame.current;
    if (frameNode === null) return;
    const focusable = [...frameNode.querySelectorAll<HTMLElement>(FOCUSABLE)];
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
  };

  return (
    <div className="scrim">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={frame}
        onKeyDown={onKeyDown}
      >
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
