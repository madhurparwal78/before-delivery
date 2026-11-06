// The line-plan vessel picker: an ARIA combobox opening a listbox that floats above every layer,
// stays inside the viewport and opens upwards when there is no room below.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface Choice {
  value: string | null;
  label: string;
}

interface Props {
  label: string;
  value: string | null;
  choices: Choice[];
  onChange: (value: string | null) => void;
  disabled?: boolean;
}

const MARGIN = 8;

export function VesselCombobox({ label, value, choices, onChange, disabled = false }: Props) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{ left: number; top: number; width: number } | null>(null);
  const selected = Math.max(0, choices.findIndex((c) => c.value === value));

  const show = () => {
    setActive(selected);
    setOpen(true);
  };
  const choose = (index: number) => {
    setOpen(false);
    onChange(choices[index].value);
    button.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    const reposition = () => {
      const anchor = button.current!.getBoundingClientRect();
      const box = list.current!.getBoundingClientRect();
      const width = Math.min(Math.max(anchor.width, 176), window.innerWidth - 2 * MARGIN);
      const left = Math.min(Math.max(MARGIN, anchor.left), window.innerWidth - width - MARGIN);
      const below = anchor.bottom + 2;
      const fitsBelow = below + box.height <= window.innerHeight - MARGIN;
      const top = fitsBelow ? below : Math.max(MARGIN, anchor.top - 2 - box.height);
      setPlace({ left, top, width });
    };
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!list.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if ((e.altKey && e.key === "ArrowDown") || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.min(choices.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1))));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : choices.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "Tab") setOpen(false);
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className="combo"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        {choices[selected]?.label ?? "Unassigned"}
      </button>
      {open && createPortal(
        <ul
          ref={list}
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          className="listbox"
          style={place ? { left: place.left, top: place.top, width: place.width } : { left: 0, top: 0, visibility: "hidden" }}
        >
          {choices.map((c, i) => (
            <li
              key={c.value ?? "none"}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === selected}
              className={i === active ? "active" : undefined}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => choose(i)}
            >
              {c.label}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </>
  );
}
