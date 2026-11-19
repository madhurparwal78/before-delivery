import { useEffect, useRef, type ReactNode } from 'react';

const focusableSelector =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface DialogProps {
  name: string;
  onClose: () => void;
  children: ReactNode;
}

export function Dialog({ name, onClose, children }: DialogProps): JSX.Element {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panel.current?.querySelector<HTMLElement>(focusableSelector);
    first?.focus();
    return () => {
      opener.current?.focus();
    };
  }, []);

  return (
    <div className="dialog-scrim">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={name}
        ref={panel}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
            return;
          }
          if (event.key !== 'Tab') {
            return;
          }
          const nodes = Array.from(panel.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []).filter(
            (node) => node.offsetParent !== null || node === document.activeElement,
          );
          if (nodes.length === 0) {
            return;
          }
          const first = nodes[0];
          const last = nodes[nodes.length - 1];
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
