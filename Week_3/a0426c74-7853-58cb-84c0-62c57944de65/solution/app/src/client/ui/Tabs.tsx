import { useRef } from 'react';
import type { KeyboardEvent } from 'react';

interface TabItem {
  id: string;
  label: string;
  /** DOM id of the tab, for the panel's `aria-labelledby` */
  tabId?: string;
  /** DOM id of the tab panel this tab controls */
  panelId?: string;
}

interface TabsProps {
  /** the tablist's accessible name: `Layouts`, `Panels`... */
  label: string;
  items: readonly TabItem[];
  selected: string;
  onSelect: (id: string) => void;
  className?: string;
}

/**
 * WAI-ARIA tablist with automatic activation: roving tabindex, ArrowLeft/ArrowRight wrap, Home and End.
 * Only the tablist is drawn; the owner renders the tab panel.
 */
export function Tabs({ label, items, selected, onSelect, className }: TabsProps) {
  const refs = useRef(new Map<string, HTMLButtonElement>());

  function targetIndex(key: string, current: number): number | undefined {
    if (key === 'Home') return 0;
    if (key === 'End') return items.length - 1;
    if (key === 'ArrowRight') return (current + 1) % items.length;
    if (key === 'ArrowLeft') return (current - 1 + items.length) % items.length;
    return undefined;
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const index = targetIndex(event.key, items.findIndex((item) => item.id === selected));
    const next = index === undefined ? undefined : items[index];
    if (!next) return;
    event.preventDefault();
    onSelect(next.id);
    refs.current.get(next.id)?.focus();
  }

  return (
    <div className={['tabs', className ?? ''].filter(Boolean).join(' ')} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {items.map((item) => (
        <button
          key={item.id}
          ref={(element) => {
            if (element) refs.current.set(item.id, element);
            else refs.current.delete(item.id);
          }}
          id={item.tabId}
          type="button"
          role="tab"
          className="tab"
          aria-selected={item.id === selected}
          aria-controls={item.panelId}
          tabIndex={item.id === selected ? 0 : -1}
          onClick={() => onSelect(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
