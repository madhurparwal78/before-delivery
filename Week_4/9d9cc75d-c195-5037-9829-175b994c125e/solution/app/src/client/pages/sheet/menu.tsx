import { useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';

interface MenuItem {
  label: string;
  /** shown as the current choice */
  current?: boolean;
  onChoose: () => void;
}

interface MenuProps {
  /** the accessible name, as the brief names the menu */
  name: string;
  items: readonly MenuItem[];
  /** Escape, Tab or a press outside: the owner closes the menu and returns focus to its trigger */
  onClose: () => void;
}

/**
 * A `role="menu"` popup that opens with focus on its first item (or the current one). Arrows move between items and
 * wrap, Home and End jump, Enter or a click chooses, Escape and Tab close.
 */
export function Menu({ name, items, onClose }: MenuProps) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  const buttons = () => [...(box.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];

  useLayoutEffect(() => {
    const all = buttons();
    (all.find((button) => button.dataset.current === 'true') ?? all[0])?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !box.current?.contains(event.target)) close.current();
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const all = buttons();
    const at = all.findIndex((button) => button === document.activeElement);
    const go = (index: number) => {
      event.preventDefault();
      all[(index + all.length) % all.length]?.focus();
    };
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') go(at + 1);
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') go(at - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(all.length - 1);
    else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <div ref={box} role="menu" aria-label={name} className="menu" onKeyDown={onKeyDown}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          tabIndex={-1}
          className="menu-item"
          data-current={item.current ? 'true' : undefined}
          onClick={item.onChoose}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
