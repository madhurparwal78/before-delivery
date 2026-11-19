import { useEffect, useRef } from 'preact/hooks';
import { Icon } from './Icon.tsx';

interface Props {
  title: string;
  onClose: () => void;
  children: preact.ComponentChild;
  labelledBy?: string;
  width?: number;
}

export function Dialog({ title, onClose, children, labelledBy, width }: Props): preact.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button, [href], [tabindex]');
    first?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key === 'Tab' && ref.current) {
        const focusables = Array.from(ref.current.querySelectorAll<HTMLElement>('input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])')).filter(el => !el.hasAttribute('disabled'));
        if (focusables.length === 0) return;
        const firstEl = focusables[0]!;
        const lastEl = focusables[focusables.length - 1]!;
        if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
        else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, []);

  return (
    <div class="dialog-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} class="dialog" style={width ? `width:${width}px` : ''}>
        <h2 id={labelledBy}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function DialogActions({ onCancel, primaryLabel, onPrimary, danger }: { onCancel: () => void; primaryLabel: string; onPrimary: () => void; danger?: boolean }): preact.JSX.Element {
  return (
    <div class="actions">
      <button type="button" class="btn-secondary" onClick={onCancel}>Cancel</button>
      <button type="button" class="btn-primary" style={danger ? 'background:var(--rust)' : ''} onClick={onPrimary}>{primaryLabel}</button>
    </div>
  );
}
