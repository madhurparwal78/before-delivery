import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  title: string;
  onClose: () => void;
  returnFocusTo?: HTMLElement | null;
  initialFocus?: 'first' | 'last';
  children: React.ReactNode;
  className?: string;
}

export const Dialog = ({
  title,
  onClose,
  returnFocusTo,
  initialFocus = 'first',
  children,
  className,
}: DialogProps) => {
  const frame = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = frame.current;
    if (node === null) return;
    const focusable = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const target = initialFocus === 'last' ? focusable.at(-1) : focusable[0];
    target?.focus();
    return () => {
      returnFocusTo?.focus();
    };
  }, [initialFocus, returnFocusTo]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const node = frame.current;
    if (node === null) return;
    const focusable = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`dialog ${className ?? ''}`}
        ref={frame}
        onKeyDown={onKeyDown}
      >
        <h2 className="dialog-title">{title}</h2>
        {children}
      </div>
    </div>
  );
};
