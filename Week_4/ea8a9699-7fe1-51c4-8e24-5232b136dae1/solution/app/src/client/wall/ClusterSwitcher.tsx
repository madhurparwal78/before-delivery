// The tray switcher: a select-only combobox whose options exist only while its list is open, so the wall's
// other cluster lists (the add-to-cluster picker) are the only options on screen otherwise.
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ClusterSummary } from "../../shared/api.js";

interface Props {
  options: ClusterSummary[];
  activeId: string | null;
  activeTitle: string | null;
  onChoose: (id: string) => void;
}

export function ClusterSwitcher({ options, activeId, activeTitle, onChoose }: Props) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const box = useRef<HTMLDivElement | null>(null);
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent): void => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const show = (): void => {
    setHighlight(Math.max(0, options.findIndex((o) => o.id === activeId)));
    setOpen(true);
  };
  const choose = (index: number): void => {
    const option = options[index];
    setOpen(false);
    box.current?.focus();
    if (option) onChoose(option.id);
  };

  return (
    <div ref={root} className="switcher-box">
      <div
        ref={box}
        role="combobox"
        tabIndex={0}
        aria-label="Tray cluster"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="tray-cluster-options"
        aria-activedescendant={open ? `tray-cluster-${highlight}` : undefined}
        className="switcher-box__value"
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(event) => {
          if (!open) {
            if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
              event.preventDefault();
              show();
            }
            return;
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setHighlight((h) => Math.max(0, Math.min(options.length - 1, h + (event.key === "ArrowDown" ? 1 : -1))));
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            choose(highlight);
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          } else if (event.key === "Tab") setOpen(false);
        }}
      >
        <span className="switcher-box__text">{activeTitle ?? "Choose a cluster"}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </div>
      {open && (
        <ul id="tray-cluster-options" role="listbox" aria-label="Clusters for the tray" className="picker switcher-box__list">
          {options.map((c, i) => (
            <li
              key={c.id}
              id={`tray-cluster-${i}`}
              role="option"
              aria-selected={i === highlight}
              className="picker__option"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(i)}
            >
              {c.title}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
