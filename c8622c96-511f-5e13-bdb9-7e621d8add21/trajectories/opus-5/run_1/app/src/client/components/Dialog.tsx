import { useEffect, useRef } from 'react';
import { useEscape, useFocusTrap } from '../hooks.js';

export interface DialogProps {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}

/** A dialog that opens on its first control, traps Tab, and closes on Escape. */
export function Dialog({ label, onClose, children }: DialogProps): React.ReactElement {
  const panel = useRef<HTMLDivElement | null>(null);
  useFocusTrap(panel);
  useEscape(onClose);
  useEffect(() => {
    const first = panel.current?.querySelector<HTMLElement>(
      'input:not([disabled]), textarea, select, button:not([disabled])',
    );
    first?.focus();
  }, []);
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-label={label} ref={panel}>
        {children}
      </div>
    </div>
  );
}
