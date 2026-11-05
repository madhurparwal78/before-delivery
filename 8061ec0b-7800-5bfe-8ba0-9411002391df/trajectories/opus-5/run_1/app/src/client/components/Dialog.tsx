import { useEffect, useRef, useState, type ReactNode } from 'react';
import { animate } from 'motion';
import { prefersReducedMotion, SPEED } from '../lib/motion';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface DialogProps {
  name: string;
  open: boolean;
  onCancel: () => void;
  children: ReactNode;
}

/** A modal dialog that rises in, keeps Tab inside, closes on Escape and leaves on time. */
export function Dialog({ name, open, onCancel, children }: DialogProps): ReactNode {
  const [rendered, setRendered] = useState(open);
  const panel = useRef<HTMLDivElement>(null);
  const exiting = useRef(false);

  useEffect(() => {
    if (open) {
      exiting.current = false;
      setRendered(true);
      return;
    }
    if (!rendered) return;
    const element = panel.current;
    if (element === null || prefersReducedMotion()) {
      setRendered(false);
      return;
    }
    exiting.current = true;
    element.style.pointerEvents = 'none';
    const controls = animate(element, { opacity: [1, 0] }, { duration: SPEED.quick, ease: 'easeOut' });
    void controls.finished.then(() => {
      if (exiting.current) setRendered(false);
    });
  }, [open, rendered]);

  useEffect(() => {
    if (!rendered || !open) return;
    const element = panel.current;
    if (element === null) return;
    element.style.pointerEvents = '';
    element.style.opacity = '1';
    element.style.transform = 'translateY(0px)';
    if (!prefersReducedMotion()) {
      void animate(
        element,
        { opacity: [0, 1], transform: ['translateY(12px)', 'translateY(0px)'] },
        { duration: SPEED.medium, ease: 'easeOut' },
      );
    }
    const first = element.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
  }, [rendered, open]);

  if (!rendered) return null;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const element = panel.current;
    if (element === null) return;
    const focusable = Array.from(element.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="dialog-backdrop" onKeyDown={handleKeyDown}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={name} ref={panel}>
        {children}
      </div>
    </div>
  );
}
