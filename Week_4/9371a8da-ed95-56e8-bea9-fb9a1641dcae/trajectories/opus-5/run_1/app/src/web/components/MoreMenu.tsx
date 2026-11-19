import { useEffect, useRef, useState } from 'react';
import { LAYER_POPUP, useEscapeLayer } from '../layers.js';

export interface MenuAction {
  label: string;
  disabled?: boolean;
  run: () => void;
}

interface Props {
  actions: MenuAction[];
}

export function MoreMenu(props: Props): JSX.Element {
  const [open, setOpen] = useState<null | 'first' | 'last'>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const close = (): void => {
    setOpen(null);
    buttonRef.current?.focus();
  };
  useEscapeLayer(open === null ? null : close, LAYER_POPUP);

  useEffect(() => {
    if (open === null) return;
    const menu = menuRef.current;
    if (menu === null) return;
    const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const target = open === 'last' ? items[items.length - 1] : items[0];
    target?.focus();
  }, [open]);

  const onMenuKeyDown = (event: React.KeyboardEvent): void => {
    const menu = menuRef.current;
    if (menu === null) return;
    const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(index + 1 + items.length) % items.length]?.focus();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      items[0]?.focus();
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1]?.focus();
      return;
    }
    if (event.key === 'Tab') {
      setOpen(null);
    }
  };

  return (
    <div className="more-menu">
      <button
        type="button"
        ref={buttonRef}
        aria-haspopup="menu"
        aria-expanded={open !== null}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen(open === null ? 'first' : null)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpen('first');
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen('last');
          }
        }}
      >
        More
      </button>
      {open === null ? null : (
        <div
          className="menu"
          role="menu"
          aria-label="More"
          ref={menuRef}
          onKeyDown={onMenuKeyDown}
        >
          {props.actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-disabled={action.disabled === true ? true : undefined}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                if (action.disabled === true) return;
                setOpen(null);
                action.run();
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  if (action.disabled === true) return;
                  setOpen(null);
                  action.run();
                }
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
