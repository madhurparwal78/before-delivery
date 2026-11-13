import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

export interface MenuEntry {
  label: string;
  run: () => void;
  disabled?: boolean;
  href?: string;
}

interface Props {
  label: string;
  items: MenuEntry[];
  caret?: boolean;
}

/** A header menu: opens on click, Enter, Space or Down; arrows move; Escape closes and returns focus to its button. */
export function MenuButton({ label, items, caret = false }: Props): ReactNode {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent): void => {
      if (!button.current?.parentElement?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const entries = (): HTMLElement[] => [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

  const openAndFocus = (): void => {
    setOpen(true);
    requestAnimationFrame(() => entries()[0]?.focus());
    queueMicrotask(() => entries()[0]?.focus());
  };

  const onButtonKey = (event: KeyboardEvent): void => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      openAndFocus();
    }
  };

  const onMenuKey = (event: KeyboardEvent): void => {
    const all = entries();
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown") all[(at + 1) % all.length]?.focus();
    else if (event.key === "ArrowUp") all[(at - 1 + all.length) % all.length]?.focus();
    else if (event.key === "Home") all[0]?.focus();
    else if (event.key === "End") all[all.length - 1]?.focus();
    else if (event.key === "Escape") {
      setOpen(false);
      button.current?.focus();
    } else if (event.key === "Tab") setOpen(false);
    else return;
    if (event.key !== "Tab") event.preventDefault();
    event.stopPropagation();
  };

  const choose = (entry: MenuEntry): void => {
    if (entry.disabled) return;
    setOpen(false);
    button.current?.focus();
    entry.run();
  };

  return (
    <span className="menu-anchor">
      <button
        ref={button}
        type="button"
        className="menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => (open ? setOpen(false) : openAndFocus())}
        onKeyDown={onButtonKey}
      >
        {label}
        {caret && <span className="caret" aria-hidden="true" />}
      </button>
      {open && (
        <div ref={menu} id={id} role="menu" aria-label={label} className="menu" onKeyDown={onMenuKey}>
          {items.map((entry) =>
            entry.href ? (
              <a key={entry.label} role="menuitem" className="menu-item" href={entry.href} onClick={() => choose(entry)}>
                {entry.label}
              </a>
            ) : (
              <button key={entry.label} type="button" role="menuitem" className="menu-item" aria-disabled={entry.disabled || undefined} onClick={() => choose(entry)}>
                {entry.label}
              </button>
            ),
          )}
        </div>
      )}
    </span>
  );
}
