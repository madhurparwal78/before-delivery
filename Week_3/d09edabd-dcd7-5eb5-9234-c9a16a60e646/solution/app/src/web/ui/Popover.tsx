import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { pushLayer } from './layers';
import { tabbables } from './hooks';

interface PopoverProps {
  /** Accessible name of the button that opens it. */
  label: string;
  buttonClass?: string;
  icon: ReactNode;
  text?: string;
  /** The button shows text that is not its name (Presence, Account): the name comes from hidden content so the visible text is never a mismatch. */
  nameFromContent?: boolean;
  above?: boolean;
  menuLabel?: string;
  /** Extra class for the panel (the phone Session menu spans the screen). */
  panelClass?: string;
  children: (tools: { choose: (run: () => void) => () => void; close: () => void }) => ReactNode;
  /** Role of the panel: a real menu, or a plain panel for mixed content. */
  panel?: 'menu' | 'group';
}

/** A button with a non-modal popover: Escape or an outside press closes it and gives the button focus back. */
export function Popover({ label, buttonClass = 'chrome-btn', icon, text, nameFromContent = false, above = false, menuLabel, panelClass = '', children, panel = 'menu' }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left?: number; right?: number; top?: number; bottom?: number }>({});
  const button = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const textId = useId();

  const close = (): void => {
    setOpen(false);
    button.current?.focus({ preventScroll: true });
  };

  /** Closes the popover, hands focus back to its button, then runs the chosen action. */
  const choose = (run: () => void) => (): void => {
    setOpen(false);
    button.current?.focus({ preventScroll: true });
    run();
  };

  useEffect(() => {
    if (!open) return;
    const pop = pushLayer({ close, name: menuLabel ?? label });
    const away = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (!body.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', away, true);
    (tabbables(body.current!)[0] ?? body.current!).focus({ preventScroll: true });
    return () => {
      pop();
      document.removeEventListener('pointerdown', away, true);
    };
  }, [open]);

  const toggle = (): void => {
    if (!open) {
      const rect = button.current!.getBoundingClientRect();
      const fromRight = rect.left + rect.width / 2 > window.innerWidth / 2;
      setPosition({
        ...(fromRight ? { right: Math.max(8, window.innerWidth - rect.right) } : { left: Math.max(8, rect.left) }),
        ...(above ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }),
      });
    }
    setOpen(!open);
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (panel !== 'menu' || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...body.current!.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    event.preventDefault();
    items[next]?.focus();
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className={buttonClass}
        aria-label={nameFromContent ? undefined : label}
        aria-describedby={nameFromContent && text ? textId : undefined}
        aria-haspopup={panel === 'menu' ? 'menu' : 'true'}
        aria-expanded={open}
        onClick={toggle}
      >
        {icon}
        {text ? <span id={textId} aria-hidden={nameFromContent ? 'true' : undefined}>{text}</span> : null}
        {nameFromContent ? <span className="visually-hidden">{label}</span> : null}
      </button>
      {open
        ? createPortal(
            <div ref={body} className={`menu ${panelClass}`} role={panel === 'menu' ? 'menu' : 'group'} aria-label={menuLabel ?? label} tabIndex={-1} style={position} onKeyDown={onKeyDown}>
              {children({ choose, close })}
            </div>,
            document.getElementById('layers')!,
          )
        : null}
    </>
  );
}
