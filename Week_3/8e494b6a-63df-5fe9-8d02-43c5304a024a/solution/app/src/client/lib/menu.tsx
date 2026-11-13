// An ARIA menu: first item focused on open, arrows move, Escape closes with focus back on the opening button.
import { useEffect, useRef, type RefObject } from "react";

interface MenuItem {
  label: string;
  onSelect: () => void;
  checked?: boolean;
}

interface Props {
  label: string;
  items: MenuItem[];
  radio?: boolean;
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  className?: string;
}

export function Menu({ label, items, radio = false, anchor, onClose, className = "" }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const buttons = () => [...(box.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];

  useEffect(() => {
    (buttons().find((b) => b.getAttribute("aria-checked") === "true") ?? buttons()[0])?.focus();
    const outside = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (!box.current?.contains(target) && !anchor.current?.contains(target)) onClose();
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const move = (to: number): void => {
    const list = buttons();
    list[(to + list.length) % list.length]?.focus();
  };

  return (
    <div
      ref={box}
      role="menu"
      aria-label={label}
      className={`menu ${className}`.trim()}
      onKeyDown={(event) => {
        const list = buttons();
        const at = list.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === "ArrowDown") move(at + 1);
        else if (event.key === "ArrowUp") move(at - 1);
        else if (event.key === "Home") move(0);
        else if (event.key === "End") move(list.length - 1);
        else if (event.key === "Escape") {
          anchor.current?.focus();
          onClose();
        } else if (event.key === "Tab") {
          onClose();
          return;
        } else return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role={radio ? "menuitemradio" : "menuitem"}
          aria-checked={radio ? item.checked === true : undefined}
          className="menu-item"
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
