import { useEffect, useRef, useState, type ReactNode } from "react";

interface MenuProps {
  label: string;
  className?: string;
  buttonClassName?: string;
  buttonContent: ReactNode;
  children: (close: () => void) => ReactNode;
}

/** A button that opens a `menu` of `menuitem`s with roving arrow-key focus. */
export function Menu({ label, className, buttonClassName, buttonContent, children }: MenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!open) return;
    const items = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(at + 1) % items.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      items[(at - 1 + items.length) % items.length]?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div className={`menu ${className ?? ""}`} ref={root} onKeyDown={onKeyDown}>
      <button
        ref={button} type="button" className={buttonClassName} aria-label={label} aria-haspopup="menu"
        aria-expanded={open} onClick={() => setOpen(!open)}
      >
        {buttonContent}
      </button>
      {open && <div className="menu-list" role="menu" aria-label={label}>{children(() => close(false))}</div>}
    </div>
  );
}
