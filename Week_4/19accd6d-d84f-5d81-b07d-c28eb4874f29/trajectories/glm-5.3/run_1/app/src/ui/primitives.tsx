import { useEffect, useRef, type ReactNode } from 'react';

/** The confirm-and-compare dialog style: centred, rounded, dimmed (Visual design). */
export function Dialog({
  title,
  onClose,
  children,
  focusFirst = true,
  label,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  focusFirst?: boolean;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement;
    const node = ref.current;
    if (node && focusFirst) {
      const focusable = node.querySelector<HTMLElement>('button, [href], input, select, textarea');
      focusable?.focus();
    }
    return () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [focusFirst]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        // Tab and Shift+Tab wrap inside the dialog and never reach the page behind.
        const node = ref.current;
        if (!node) return;
        const focusables = Array.from(node.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((el) => !(el as HTMLButtonElement).disabled);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey) {
          if (active === first || !node.contains(active)) { e.preventDefault(); last.focus(); }
        } else if (active === last || !node.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} ref={ref} data-dialog={label}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, error }: { label: string; children: ReactNode; error?: string }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {error ? <div className="field-error">{error}</div> : null}
    </div>
  );
}
