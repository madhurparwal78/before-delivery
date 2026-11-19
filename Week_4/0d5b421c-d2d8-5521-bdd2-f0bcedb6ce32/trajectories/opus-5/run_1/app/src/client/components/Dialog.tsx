import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

interface DialogProps {
  label: string;
  children: ReactNode;
  /** Undefined while a request is pending, so Escape does nothing. */
  onEscape?: (() => void) | undefined;
  initialFocusRef?: RefObject<HTMLElement | null>;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({ label, children, onEscape, initialFocusRef }: DialogProps): JSX.Element {
  const container = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const target =
      initialFocusRef?.current ?? container.current?.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus();
  }, [initialFocusRef]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onEscape?.();
      return;
    }
    if (event.key !== 'Tab') return;
    const nodes = Array.from(container.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (nodes.length === 0) return;
    const first = nodes[0] as HTMLElement;
    const last = nodes[nodes.length - 1] as HTMLElement;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !container.current?.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        ref={container}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  );
}
