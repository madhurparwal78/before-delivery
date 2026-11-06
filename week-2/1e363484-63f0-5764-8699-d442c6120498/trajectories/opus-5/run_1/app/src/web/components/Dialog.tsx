import { useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  readonly label: string;
  readonly onClose: () => void;
  readonly initialFocus: 'first' | 'last';
  readonly children: ReactNode;
}

/** A modal dialog that keeps Tab inside, closes on Escape and returns focus to its opener. */
export function Dialog({ label, onClose, initialFocus, children }: DialogProps): React.ReactElement {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement;
    const frame = frameRef.current;
    if (frame !== null) {
      const targets = [...frame.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const target = initialFocus === 'first' ? targets[0] : targets[targets.length - 1];
      target?.focus();
    }
    return () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, [initialFocus]);

  return (
    <div
      className="dialog-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(16, 26, 18, 0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
        zIndex: 40,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        ref={frameRef}
        className="panel dialog-enter"
        style={{ maxWidth: 'min(46rem, 94vw)', maxHeight: '86vh', overflow: 'auto', width: '100%' }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
            return;
          }
          if (event.key !== 'Tab') return;
          const frame = frameRef.current;
          if (frame === null) return;
          const targets = [...frame.querySelectorAll<HTMLElement>(FOCUSABLE)];
          if (targets.length === 0) return;
          const first = targets[0]!;
          const last = targets[targets.length - 1]!;
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
