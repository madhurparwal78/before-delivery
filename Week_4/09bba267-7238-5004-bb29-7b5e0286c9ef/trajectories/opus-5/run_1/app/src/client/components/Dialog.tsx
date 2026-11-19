import { useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  readonly title: string;
  readonly children: ReactNode;
  /** Escape does nothing while a payment or change is confirming. */
  readonly closable: boolean;
  readonly onClose: () => void;
  readonly initialFocus?: 'first' | 'none';
}

/** A modal dialog that keeps Tab inside itself and gives focus back to its opener when it closes. */
export function Dialog({ title, children, closable, onClose, initialFocus = 'first' }: DialogProps): ReactNode {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    return () => {
      const target = opener.current;
      if (target instanceof HTMLElement && target.isConnected) target.focus();
      else document.querySelector<HTMLElement>('[data-focus-fallback]')?.focus();
    };
  }, []);

  useEffect(() => {
    if (initialFocus === 'none') return;
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
  }, [initialFocus]);

  return (
    <div className="dialog-layer">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panel}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            if (!closable) return;
            event.stopPropagation();
            onClose();
            return;
          }
          if (event.key !== 'Tab') return;
          const focusable = [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
          if (focusable.length === 0) return;
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
        }}
      >
        {children}
      </div>
    </div>
  );
}
