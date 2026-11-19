import { useId, useState, type KeyboardEvent } from "react";

interface Choice {
  value: string;
  label: string;
}

interface Props {
  label: string;
  choices: readonly Choice[];
  selected: string | null;
  onSelect: (value: string | null) => void;
  autoFocus?: boolean;
}

/** A text field that filters its list as you type: ArrowDown and ArrowUp move through the choices, Enter picks one. */
export function Combobox({ label, choices, selected, onSelect, autoFocus }: Props) {
  const id = useId();
  const picked = choices.find((choice) => choice.value === selected);
  const [text, setText] = useState(picked?.label ?? "");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const shown = picked && picked.label === text ? choices : choices.filter((choice) => choice.label.toLowerCase().includes(text.trim().toLowerCase()));

  const pick = (choice: Choice) => {
    onSelect(choice.value);
    setText(choice.label);
    setOpen(false);
    setHighlight(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) setOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlight(open ? Math.min(shown.length - 1, Math.max(0, highlight + step)) : 0);
    } else if (event.key === "Enter" && open && shown[highlight]) {
      event.preventDefault();
      pick(shown[highlight]);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className="combobox">
      <input
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={open && shown[highlight] ? `${id}-${highlight}` : undefined}
        autoComplete="off"
        data-autofocus={autoFocus ? "" : undefined}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
          setHighlight(0);
          if (selected !== null) onSelect(null);
        }}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
      />
      {open && shown.length === 0 ? <p className="no-choice">Nothing matches.</p> : null}
      {open && shown.length > 0 ? (
        <ul id={`${id}-list`} role="listbox" aria-label={`${label} options`} className="choices">
          {shown.map((choice, index) => (
            <li
              key={choice.value}
              id={`${id}-${index}`}
              role="option"
              aria-selected={index === highlight}
              data-highlighted={index === highlight ? "true" : undefined}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(choice)}
            >
              {choice.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
