import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

interface OverlayProps {
  label: string;
  className: string;
  state: 'open' | 'closing';
  onClose(): void;
  children: React.ReactNode;
}

export function Overlay({ label, className, state, onClose, children }: OverlayProps): React.ReactElement {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const items = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    items?.[0]?.focus();
  }, []);

  const trap = (event: React.KeyboardEvent): void => {
    if (event.key !== 'Tab') return;
    const items = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (!items || items.length === 0) return;
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className={`overlay ${state === 'closing' ? 'overlay-closing' : 'overlay-open'}`}>
      <div className="overlay-backdrop" onClick={onClose} />
      <div
        className={`overlay-panel ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        ref={panelRef}
        onKeyDown={trap}
      >
        {children}
      </div>
    </div>
  );
}
