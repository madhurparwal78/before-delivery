// A menu button: Down or Enter opens it, arrow keys move, Escape closes and returns focus.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  icon?: ReactNode;
}

interface Props {
  label: string;
  menuLabel: string;
  items: MenuItem[];
  className?: string;
  children: ReactNode;
  align?: "start" | "end";
  up?: boolean;
}

export function MenuButton({ label, menuLabel, items, className = "", children, align = "start", up = false }: Props) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    menu.current?.querySelector<HTMLElement>("[role=menuitem]:not([aria-disabled=true])")?.focus();
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const move = (step: number) => {
    const entries = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const at = entries.indexOf(document.activeElement as HTMLElement);
    entries[(at + step + entries.length) % entries.length]?.focus();
  };

  const onMenuKey = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") move(1);
    else if (event.key === "ArrowUp") move(-1);
    else if (event.key === "Escape") {
      setOpen(false);
      button.current?.focus();
    } else if (event.key === "Tab") setOpen(false);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div className={`menu-wrap ${className}`}>
      <button ref={button} type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
        className="menu-button" onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
          }
        }}>
        {children}
      </button>
      {open && (
        <div ref={menu} id={id} role="menu" aria-label={menuLabel} className={`menu menu-${align}${up ? " menu-up" : ""}`} onKeyDown={onMenuKey}>
          {items.map((item) => (
            <div key={item.label} role="menuitem" tabIndex={-1} aria-disabled={item.disabled || undefined} className="menuitem"
              onClick={() => {
                if (item.disabled) return;
                setOpen(false);
                item.onSelect();
              }}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && !item.disabled) {
                  e.preventDefault();
                  setOpen(false);
                  item.onSelect();
                }
              }}>
              {item.icon}
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
