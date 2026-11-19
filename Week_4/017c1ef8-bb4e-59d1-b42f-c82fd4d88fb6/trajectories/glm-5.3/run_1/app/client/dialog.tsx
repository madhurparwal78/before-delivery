import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

/**
 * Dialog: focus starts on the first field (or first button), Tab stays inside,
 * Escape/Cancel closes it and focus returns to the control that opened it.
 */
export const Dialog = ({
  label, onClose, children, open = true, closeButton = true,
}: {
  label: string; onClose: () => void; children: ReactNode; open?: boolean; closeButton?: boolean;
}): JSX.Element | null => {
  const ref = useRef<HTMLDivElement | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const generatedId = useId();

  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement as HTMLElement | null;
    const node = ref.current;
    if (node) {
      const focusables = node.querySelectorAll<HTMLElement>('input, textarea, select, button, a, [tabindex]:not([tabindex="-1"])');
      const target = Array.from(focusables).find((el) => !el.hasAttribute('disabled')) ?? null;
      (target ?? node).focus();
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'Tab' && node) {
        const focusables = Array.from(node.querySelectorAll<HTMLElement>(
          'input, textarea, select, button, a, [tabindex]:not([tabindex="-1"])',
        )).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      const opener = returnFocus.current;
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        id={`dialog-${generatedId}`}
        tabIndex={-1}
        className="dialog-panel"
      >
        {children}
        {closeButton && <button type="button" className="text-button dialog-cancel" onClick={onClose}>Cancel</button>}
      </div>
    </div>
  );
};

export const Menu = ({
  label, onClose, children, align,
}: {
  label: string; onClose: () => void; children: ReactNode; align?: 'left' | 'right';
}): JSX.Element => {
  const ref = useRef<HTMLDivElement | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    const node = ref.current;
    if (node) {
      const first = node.querySelector<HTMLElement>('button, [role="menuitem"]');
      first?.focus();
    }
    const onKey = (e: KeyboardEvent): void => {
      const node2 = ref.current;
      if (!node2) return;
      const items = Array.from(node2.querySelectorAll<HTMLElement>('[role="menuitem"]'));
      if (items.length === 0) return;
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        items[(index + 1) % items.length].focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        items[(index - 1 + items.length) % items.length].focus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (document.activeElement instanceof HTMLElement) {
          e.preventDefault();
          document.activeElement.click();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      const opener = returnFocus.current;
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [onClose]);

  return (
    <div ref={ref} role="menu" aria-label={label} className={`menu ${align === 'right' ? 'menu-right' : ''}`}>
      {children}
    </div>
  );
};

export const MenuItem = ({
  label, onSelect, danger = false, disabled = false,
}: { label: string; onSelect: () => void; danger?: boolean; disabled?: boolean }): JSX.Element => (
  <button type="button" role="menuitem" className={`menu-item ${danger ? 'menu-item-danger' : ''}`} onClick={onSelect} disabled={disabled}>
    {label}
  </button>
);
