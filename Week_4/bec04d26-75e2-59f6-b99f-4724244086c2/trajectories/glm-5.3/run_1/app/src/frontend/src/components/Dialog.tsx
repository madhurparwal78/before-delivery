import { useEffect, useRef } from 'react';

export interface DialogProps {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
  openerRef: React.RefObject<HTMLElement | null>;
}

/** A keyboard-complete dialog: focus to the first field, Escape closes, focus returns to the opener. */
export function Dialog({ label, onClose, children, openerRef }: DialogProps): React.ReactNode {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = dialogRef.current;
    if (node === null) return;
    const focusables = node.querySelectorAll<HTMLElement>(
      'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])',
    );
    const first = focusables[0];
    (first ?? node).focus();
    const previousOpener = openerRef.current;
    return () => {
      if (previousOpener !== null && document.contains(previousOpener)) {
        previousOpener.focus();
      } else {
        const heading = document.querySelector('h1');
        if (heading !== null) heading.focus();
      }
    };
  }, [openerRef]);

  return (
    <div className="dialog-backdrop" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="dialog"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
          if (event.key === 'Tab') {
            const focusables = Array.from(
              dialogRef.current?.querySelectorAll<HTMLElement>(
                'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])',
              ) ?? [],
            ).filter((el) => !el.hasAttribute('disabled'));
            if (focusables.length === 0) return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
