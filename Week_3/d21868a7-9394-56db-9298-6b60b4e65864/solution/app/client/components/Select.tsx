// A select-only combobox (WAI-ARIA APG pattern): the options exist only while the list is open, so a
// closed field never shows up among the page's options (the search suggestions are options too).
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

interface Choice {
  value: string;
  text: string;
}

interface SelectProps {
  id: string;
  labelId: string;
  value: string;
  choices: Choice[];
  placeholder: string;
  onChange: (value: string) => void;
  describedBy?: string;
  invalid?: boolean;
}

export function Select({ id, labelId, value, choices, placeholder, onChange, describedBy, invalid }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const selected = choices.find((c) => c.value === value);
  const optionId = (index: number) => `${id}-option-${index}`;

  useEffect(() => {
    if (open) listRef.current?.querySelector(`#${CSS.escape(optionId(active))}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const show = () => {
    setActive(Math.max(0, choices.findIndex((c) => c.value === value)));
    setOpen(true);
  };
  const choose = (choice: Choice) => {
    setOpen(false);
    if (choice.value !== value) onChange(choice.value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = choices.length - 1;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        show();
      }
      return;
    }
    const moves: Record<string, number> = { ArrowDown: Math.min(last, active + 1), ArrowUp: Math.max(0, active - 1), Home: 0, End: last };
    if (event.key in moves) {
      event.preventDefault();
      setActive(moves[event.key]!);
    } else if ((event.key === "Enter" || event.key === " ") && choices[active]) {
      event.preventDefault();
      choose(choices[active]);
    } else if (event.key === "Escape") {
      // Closing the list is all Escape does here; a dialog around the form stays open.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div className="select">
      <div
        id={id}
        role="combobox"
        tabIndex={0}
        className="select-control"
        aria-labelledby={labelId}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open && choices[active] ? optionId(active) : undefined}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
      >
        <span className={selected ? "select-value" : "select-value select-placeholder"}>{selected?.text ?? placeholder}</span>
        <ChevronDown size={18} aria-hidden="true" className="select-chevron" />
      </div>
      {open && (
        <ul ref={listRef} id={`${id}-list`} role="listbox" aria-labelledby={labelId} className="select-list">
          {choices.map((choice, index) => (
            <li
              key={choice.value}
              id={optionId(index)}
              role="option"
              aria-selected={choice.value === value}
              className={`select-option${index === active ? " is-active" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => setActive(index)}
              onClick={() => choose(choice)}
            >
              {choice.text}
            </li>
          ))}
          {choices.length === 0 && <li className="select-empty">Nothing to choose yet.</li>}
        </ul>
      )}
    </div>
  );
}
