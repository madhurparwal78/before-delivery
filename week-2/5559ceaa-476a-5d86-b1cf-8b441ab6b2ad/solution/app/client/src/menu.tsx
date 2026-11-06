import { type ReactNode, useEffect, useRef, useState } from "react";

interface MenuItem {
  label: string;
  onSelect: () => void;
}

interface MenuButtonProps {
  label: string;
  menuLabel: string;
  items: MenuItem[];
  className?: string;
  children: ReactNode;
  align?: "start" | "end";
}

/** A button that opens a menu: arrow keys move, Enter picks, Escape closes and returns focus to the button. */
export function MenuButton({ label, menuLabel, items, className, children, align = "start" }: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    const entries = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = entries.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      entries[(at + step + entries.length) % entries.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      entries[event.key === "Home" ? 0 : entries.length - 1]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") {
      close(false);
    }
  };

  return (
    <div className="menu-anchor">
      <button
        ref={button}
        type="button"
        className={className}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {children}
      </button>
      {open && (
        <ul ref={menu} role="menu" aria-label={menuLabel} className={`menu menu-${align}`} onKeyDown={onKeyDown}>
          {items.map((item) => (
            <li
              key={item.label}
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                close(true);
                item.onSelect();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  close(true);
                  item.onSelect();
                }
              }}
            >
              {item.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
