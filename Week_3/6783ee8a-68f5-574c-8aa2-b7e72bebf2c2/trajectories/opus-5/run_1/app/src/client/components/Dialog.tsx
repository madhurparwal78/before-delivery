import { useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface DialogProps {
  name: string;
  children: ReactNode;
  /** Escape and the dimmed area close every dialog but the conflict dialog. */
  dismissable?: boolean;
  onClose: () => void;
  variant?: 'centred' | 'sheet' | 'drawer';
}

/**
 * A dialog that keeps Tab and Shift+Tab cycling inside it, wrapping from the
 * last control to the first and back.
 */
export function Dialog({
  name,
  children,
  dismissable = true,
  onClose,
  variant = 'centred',
}: DialogProps): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement;
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panelRef.current)?.focus();
    return () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, []);

  return (
    <div className={`overlay overlay-${variant}`}>
      <div
        className="overlay-screen"
        onMouseDown={() => {
          if (dismissable) onClose();
        }}
      />
      <div
        className={`dialog dialog-${variant}`}
        role="dialog"
        aria-modal="true"
        aria-label={name}
        tabIndex={-1}
        ref={panelRef}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && dismissable) {
            event.preventDefault();
            event.stopPropagation();
            onClose();
            return;
          }
          if (event.key !== 'Tab') return;
          const focusable = [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
          if (focusable.length === 0) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
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
