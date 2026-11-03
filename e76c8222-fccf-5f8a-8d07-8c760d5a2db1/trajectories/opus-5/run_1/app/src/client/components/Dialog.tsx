import { ReactElement, ReactNode, useEffect, useRef } from 'react';

const FOCUSABLE = 'button:not([disabled]), input, select, textarea, a[href]';

export function Dialog({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}): ReactElement {
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement;
    frame.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !frame.current) return;
      const focusable = Array.from(frame.current.querySelectorAll<HTMLElement>(FOCUSABLE));
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
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(27, 26, 23, 0.25)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 60,
      }}
    >
      <div ref={frame} role="dialog" aria-modal="true" aria-label={label} className="dialog-frame">
        {children}
      </div>
    </div>
  );
}
