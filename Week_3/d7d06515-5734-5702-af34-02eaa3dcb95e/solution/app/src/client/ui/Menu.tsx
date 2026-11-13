// Row-actions menu: roving focus, Escape and Tab close it, an outside press closes it (brief: Dashboard row actions).
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface MenuItem {
  label: string;
  onSelect: () => void;
}

interface MenuProps {
  label: string;
  items: MenuItem[];
  anchor: HTMLElement;
  onClose: () => void;
}

export function Menu({ label, items, anchor, onClose }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const rect = anchor.getBoundingClientRect();

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const entries = (): HTMLElement[] => [...node.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    entries()[0]?.focus();

    const close = (restoreFocus: boolean): void => {
      if (restoreFocus) anchor.focus();
      closeRef.current();
    };
    const onKey = (event: KeyboardEvent): void => {
      const items = entries();
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      } else if (event.key === 'Tab') {
        close(true);
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        const last = items.length - 1;
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? last
          : event.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
        items[next]?.focus();
      }
    };
    const onPress = (event: MouseEvent): void => {
      if (!node.contains(event.target as Node) && !anchor.contains(event.target as Node)) close(false);
    };
    const onViewport = (): void => close(false);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onPress, true);
    window.addEventListener('resize', onViewport);
    window.addEventListener('scroll', onViewport, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onPress, true);
      window.removeEventListener('resize', onViewport);
      window.removeEventListener('scroll', onViewport, true);
    };
  }, [anchor]);

  return createPortal(
    <div ref={ref} role="menu" aria-label={label} className="menu" style={{ top: rect.bottom + 4, right: document.documentElement.clientWidth - rect.right }}>
      {items.map((item) => (
        <button key={item.label} type="button" role="menuitem" tabIndex={-1} className="menu-item" onClick={() => { item.onSelect(); onClose(); }}>
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
