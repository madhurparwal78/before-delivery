import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { moveRovingFocus } from './roving';

interface MenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

interface MenuProps {
  /** The trigger's accessible name and, unless `children` is given, its text. */
  label: string;
  items: MenuItem[];
  /** Visible trigger content when it differs from the accessible name. */
  children?: ReactNode;
  className?: string;
  triggerClassName?: string;
  /** Where focus goes after an item is chosen, when not the trigger (confirming Block removes the trigger). */
  closeFocus?: () => HTMLElement | null;
  onOpenChange?: (open: boolean) => void;
}

/**
 * A button that opens a menu. Opens on Enter, Space or click; ArrowDown and ArrowUp move between items,
 * Enter chooses, Escape closes and returns focus to the button. Choosing an item closes the menu and puts focus
 * on the button before `onSelect` runs, so a dialog opened by the item returns focus to the button.
 */
export function Menu({ label, items, children, className, triggerClassName, closeFocus, onOpenChange }: MenuProps) {
  const [open, setOpenState] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const setOpen = (next: boolean): void => {
    setOpenState(next);
    onOpenChange?.(next);
  };

  useLayoutEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const outside = (event: MouseEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
    // setOpen only forwards to the parent's callback.
  }, [open]);

  const onMenuKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    const enabled = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
    moveRovingFocus(event, enabled, { orientation: 'vertical', wrap: true, homeEnd: true });
  };

  const choose = (item: MenuItem): void => {
    setOpen(false);
    (closeFocus?.() ?? trigger.current)?.focus();
    item.onSelect();
  };

  return (
    <div ref={root} className={className ? `menu-root ${className}` : 'menu-root'}>
      <button
        ref={trigger}
        type="button"
        className={triggerClassName ?? 'button'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={children ? label : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {children ?? label}
      </button>
      {open ? (
        <div ref={menu} id={menuId} role="menu" aria-label={label} className="menu" onKeyDown={onMenuKeyDown}>
          {items.map((item) => (
            <button key={item.label} type="button" role="menuitem" className="menu-item" tabIndex={-1} disabled={item.disabled} onClick={() => choose(item)}>
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
