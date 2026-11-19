import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { collapseMenu } from './menu-state.js';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])';

/** A modal dialog that keeps Tab and Shift+Tab inside it. */
export function Dialog({
  label,
  children,
  onEscape,
}: {
  label: string;
  children: ReactNode;
  onEscape: (() => void) | null;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    collapseMenu();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (onEscape) {
        event.preventDefault();
        onEscape();
      }
      return;
    }
    if (event.key !== 'Tab') return;
    const node = panel.current;
    if (!node) return;
    const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div onKeyDown={onKeyDown}>
      <div className="dialog-backdrop" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="sheet-panel"
      >
        {children}
      </div>
    </div>
  );
}
