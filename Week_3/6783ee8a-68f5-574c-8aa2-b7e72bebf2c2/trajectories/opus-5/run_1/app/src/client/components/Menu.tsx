import { useEffect, useId, useRef, useState } from 'react';

export interface MenuItem {
  label: string;
  onChoose: () => void;
  disabled?: boolean;
}

interface MenuProps {
  name: string;
  caret?: boolean;
  items: MenuItem[];
  className?: string;
}

/** A plain text header menu: opens on click, Enter, Space or Down. */
export function Menu({ name, caret = false, items, className }: MenuProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const items = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    items?.item(active)?.focus();
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (
        !listRef.current?.contains(event.target as Node) &&
        !buttonRef.current?.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const close = (returnFocus: boolean): void => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  return (
    <div className={`menu ${className ?? ''}`}>
      <button
        type="button"
        ref={buttonRef}
        className="menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          setActive(0);
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive(0);
            setOpen(true);
          }
        }}
      >
        {name}
        {caret ? <span className="caret" aria-hidden="true" /> : null}
      </button>
      {open ? (
        <div
          className="menu-list"
          id={id}
          role="menu"
          aria-label={name}
          ref={listRef}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              close(true);
              return;
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((current) => (current + 1) % items.length);
              return;
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((current) => (current - 1 + items.length) % items.length);
              return;
            }
            if (event.key === 'Tab') {
              close(false);
            }
          }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="menu-item"
              disabled={item.disabled}
              tabIndex={-1}
              onClick={() => {
                close(true);
                item.onChoose();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
