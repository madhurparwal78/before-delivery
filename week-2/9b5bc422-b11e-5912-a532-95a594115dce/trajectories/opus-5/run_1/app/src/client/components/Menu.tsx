import { useEffect, useRef, useState } from 'react';

export type MenuItem = { label: string; onChoose: () => void; navigates?: boolean };

/** A menu opens on its first item; arrows wrap, Enter chooses, Escape closes. */
export function Menu(props: { name: string; items: MenuItem[]; onClose: () => void }) {
  const [highlight, setHighlight] = useState(0);
  const ref = useRef<HTMLDivElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus();
  }, []);

  const close = (restore: boolean) => {
    if (restore) opener.current?.focus();
    props.onClose();
  };

  const move = (next: number) => {
    const count = props.items.length;
    const index = ((next % count) + count) % count;
    setHighlight(index);
    const items = ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    items?.[index]?.focus();
  };

  return (
    <div
      role="menu"
      aria-label={props.name}
      className="paper menu"
      ref={ref}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          move(highlight + 1);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          move(highlight - 1);
        } else if (event.key === 'Home') {
          event.preventDefault();
          move(0);
        } else if (event.key === 'End') {
          event.preventDefault();
          move(props.items.length - 1);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close(true);
        } else if (event.key === 'Tab') {
          event.preventDefault();
          close(true);
        }
      }}
      onBlur={(event) => {
        if (!ref.current?.contains(event.relatedTarget as Node)) props.onClose();
      }}
    >
      {props.items.map((item, index) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          tabIndex={index === highlight ? 0 : -1}
          className="menu-item"
          data-highlighted={index === highlight ? 'true' : undefined}
          onFocus={() => setHighlight(index)}
          onClick={() => {
            const navigates = item.navigates === true;
            if (!navigates) opener.current?.focus();
            props.onClose();
            item.onChoose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
