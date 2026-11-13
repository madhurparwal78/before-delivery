import { useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import '../../styles/drawing/menu.css';

const ITEMS = ['Pin issue here', 'Measure from here', 'Show versions'] as const;
export type SheetAction = (typeof ITEMS)[number];

/** Keeps the menu clear of the finger that opened it and inside the window. */
const FINGER_OFFSET_PX = 16;

interface SheetActionsMenuProps {
  /** the press point in window px */
  at: { x: number; y: number };
  /** the element focus returns to on Escape: the drawing pane */
  opener: RefObject<HTMLElement | null>;
  onChoose: (action: SheetAction) => void;
  onClose: () => void;
}

/** `menu "Sheet actions"`, opened by a long press on a phone. Roving focus, Escape returns to the pane. */
export function SheetActionsMenu({ at, opener, onChoose, onClose }: SheetActionsMenuProps) {
  const menu = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return undefined;
    element.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const left = Math.min(at.x + FINGER_OFFSET_PX, window.innerWidth - element.offsetWidth - FINGER_OFFSET_PX);
    const top = Math.min(at.y + FINGER_OFFSET_PX, window.innerHeight - element.offsetHeight - FINGER_OFFSET_PX);
    element.style.left = `${Math.max(FINGER_OFFSET_PX, left)}px`;
    element.style.top = `${Math.max(FINGER_OFFSET_PX, top)}px`;
    const closeOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !element.contains(event.target)) onClose();
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      opener.current?.focus();
    };
  }, [at, opener, onClose]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const index = items.findIndex((item) => item === document.activeElement);
    items[(index + step + items.length) % items.length].focus();
  }

  return (
    <div ref={menu} className="sheet-menu" role="menu" aria-label="Sheet actions" onKeyDown={onKeyDown}>
      {ITEMS.map((item) => (
        <button key={item} type="button" role="menuitem" className="sheet-menu__item" onClick={() => onChoose(item)}>{item}</button>
      ))}
    </div>
  );
}
