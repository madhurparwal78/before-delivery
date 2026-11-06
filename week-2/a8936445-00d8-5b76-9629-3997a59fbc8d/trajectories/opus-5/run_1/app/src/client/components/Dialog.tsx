import { useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}): JSX.Element {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null;
    const node = panel.current;
    if (node) {
      const targets = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const field = targets.find((element) => !(element instanceof HTMLButtonElement));
      (field ?? targets[0] ?? node).focus();
    }
    return () => opener.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const node = panel.current;
      if (!node) return;
      const targets = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (targets.length === 0) return;
      const first = targets[0]!;
      const last = targets[targets.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === node)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  return (
    <div className="backdrop">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panel}
        tabIndex={-1}
      >
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
