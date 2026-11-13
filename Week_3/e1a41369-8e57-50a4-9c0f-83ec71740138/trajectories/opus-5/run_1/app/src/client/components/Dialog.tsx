import { useEffect, useRef, type ReactNode } from 'react';
import { useSlideIn } from '../motion.js';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface DialogProps {
  name: string;
  onClose: () => void;
  children: ReactNode;
  centred?: boolean;
  returnFocusTo?: () => HTMLElement | null;
}

/** A sheet or centred dialog that keeps Tab inside it and hands focus back on close. */
export function Dialog({ name, onClose, children, centred = false, returnFocusTo }: DialogProps): JSX.Element {
  const panel = useRef<HTMLDivElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const slideIn = useSlideIn();
  const latest = useRef({ onClose, returnFocusTo });
  latest.current = { onClose, returnFocusTo };

  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    const onEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      latest.current.onClose();
    };
    const keepFocusInside = (event: FocusEvent): void => {
      const target = event.target;
      if (!panel.current || (target instanceof Node && panel.current.contains(target))) return;
      panel.current.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    };
    document.addEventListener('keydown', onEscape);
    document.addEventListener('focusin', keepFocusInside);

    return () => {
      document.removeEventListener('keydown', onEscape);
      document.removeEventListener('focusin', keepFocusInside);
      const back = latest.current.returnFocusTo;
      const target = back ? back() : opener.current;
      target?.focus();
    };
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab') return;
    const items = [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (items.length === 0) return;
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    const active = document.activeElement;
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    }
  };

  return (
    <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={name}
        className={centred ? 'dialog dialog-centred' : 'dialog dialog-sheet'}
        ref={(element) => {
          panel.current = element;
          if (!centred) slideIn(element);
        }}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  );
}
