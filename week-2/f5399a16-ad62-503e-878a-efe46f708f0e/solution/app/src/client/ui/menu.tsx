// A menu never cut off (SR13): it sits in the overlay layer at a fixed place inside the viewport.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EASE, FAST, reducedMotion } from '../motion';

interface MenuItem {
  label: string;
  onSelect: () => void;
  /** The item closes the row: focus is the action's to decide. */
  leavesFocus?: boolean;
}

const EDGE = 8;

export function MenuButton({ label, items, shortLabel = 'Actions' }: { label: string; items: MenuItem[]; shortLabel?: string }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !menu.current || !button.current) return;
    const anchor = button.current.getBoundingClientRect();
    const box = menu.current.getBoundingClientRect();
    const below = anchor.bottom + 4;
    const top = below + box.height + EDGE <= innerHeight ? below : Math.max(EDGE, anchor.top - box.height - 4);
    const left = Math.min(Math.max(EDGE, anchor.right - box.width), innerWidth - box.width - EDGE);
    menu.current.style.top = `${top}px`;
    menu.current.style.left = `${left}px`;
    menu.current.style.visibility = 'visible';
    menu.current.querySelector<HTMLElement>('[role=menuitem]')?.focus({ preventScroll: true });
    if (!reducedMotion()) {
      menu.current.animate([{ opacity: 0.4, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: FAST, easing: EASE });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const move = (event: React.KeyboardEvent) => {
    const entries = [...(menu.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];
    const at = entries.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (event.key === 'ArrowDown') next = (at + 1) % entries.length;
    else if (event.key === 'ArrowUp') next = (at - 1 + entries.length) % entries.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = entries.length - 1;
    else if (event.key === 'Tab') {
      setOpen(false);
      button.current?.focus();
      return;
    }
    if (next >= 0) {
      event.preventDefault();
      entries[next]?.focus();
    }
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className="btn btn-plain menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((held) => !held)}
      >
        <span aria-hidden="true">{shortLabel}</span>
      </button>
      {open
        ? createPortal(
            <div ref={menu} role="menu" aria-label={label} className="menu" style={{ visibility: 'hidden' }} onKeyDown={move}>
              {items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => {
                    setOpen(false);
                    button.current?.focus({ preventScroll: true });
                    item.onSelect();
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>,
            document.getElementById('overlays') as HTMLElement,
          )
        : null}
    </>
  );
}
