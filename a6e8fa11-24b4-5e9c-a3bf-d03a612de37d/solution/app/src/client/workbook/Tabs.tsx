// Tab lists with one Tab stop: Left and Right move, Enter or Space opens, F2 renames (sheet tabs only).
import { type KeyboardEvent, useRef, useState } from "react";

interface TabItem {
  id: string;
  label: string;
  badge?: number;
}

export function TabList({
  label,
  items,
  selected,
  onSelect,
  onRename,
  className,
  idPrefix,
}: {
  label: string;
  items: TabItem[];
  selected: string;
  onSelect(id: string): void;
  onRename?: (id: string) => void;
  className: string;
  idPrefix: string;
}): JSX.Element {
  const [focusId, setFocusId] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const current = items.some((i) => i.id === focusId) ? (focusId as string) : selected;

  const focusAt = (index: number): void => {
    const item = items[(index + items.length) % items.length];
    setFocusId(item.id);
    refs.current.get(item.id)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number, id: string): void => {
    if (e.key === "ArrowRight") focusAt(index + 1);
    else if (e.key === "ArrowLeft") focusAt(index - 1);
    else if (e.key === "Home") focusAt(0);
    else if (e.key === "End") focusAt(items.length - 1);
    else if (e.key === "Enter" || e.key === " ") onSelect(id);
    else if (e.key === "F2" && onRename) onRename(id);
    else return;
    e.preventDefault();
  };

  return (
    <div role="tablist" aria-label={label} className={className}>
      {items.map((item, index) => (
        <button
          key={item.id}
          ref={(el) => {
            if (el) refs.current.set(item.id, el);
            else refs.current.delete(item.id);
          }}
          type="button"
          role="tab"
          id={`${idPrefix}-${item.id}`}
          aria-selected={item.id === selected}
          aria-label={item.label}
          aria-describedby={item.badge ? `${idPrefix}-${item.id}-badge` : undefined}
          tabIndex={item.id === current ? 0 : -1}
          className={`tab${item.id === selected ? " current" : ""}`}
          onClick={() => {
            setFocusId(item.id);
            onSelect(item.id);
          }}
          onDoubleClick={() => onRename?.(item.id)}
          onKeyDown={(e) => onKeyDown(e, index, item.id)}
          onFocus={() => setFocusId(item.id)}
        >
          <span className="tab-label">{item.label}</span>
          {item.badge ? (
            <span className="badge" id={`${idPrefix}-${item.id}-badge`}>
              {item.badge}
              <span className="sr-only"> changed cells</span>
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
