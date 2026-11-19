import { useEffect, useId, useState, type ReactElement } from "react";
import { announce } from "../lib/announce";
import { CITIES } from "../../shared/towns";

interface Props {
  label: string;
  value: string;
  onSelect: (city: string) => void;
  exclude?: readonly string[];
  /** Empty the field after a town is chosen (the stopover field). */
  clearOnSelect?: boolean;
  invalid?: boolean;
  describedBy?: string;
}

export function Combobox({ label, value, onSelect, exclude = [], clearOnSelect = false, invalid, describedBy }: Props): ReactElement {
  const id = useId();
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  useEffect(() => setText(value), [value]);

  const needle = text.trim().toLowerCase();
  const matches = CITIES.filter((c) => !exclude.includes(c) && c.toLowerCase().startsWith(needle));
  const shown = open && matches.length > 0;

  const choose = (city: string): void => {
    onSelect(city);
    setText(clearOnSelect ? "" : city);
    setOpen(false);
    setActive(-1);
  };

  const move = (to: number): void => {
    const index = Math.min(matches.length - 1, Math.max(0, to));
    setOpen(true);
    setActive(index);
    const city = matches[index];
    if (city) announce(`${city}, ${index + 1} of ${matches.length}`);
  };

  return (
    <div className="combo">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={shown}
        aria-controls={shown ? `${id}-list` : undefined}
        aria-activedescendant={shown && active >= 0 ? `${id}-o${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            move(active + 1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            move(active < 0 ? 0 : active - 1);
          } else if (event.key === "Enter") {
            event.preventDefault();
            const city = shown && active >= 0 ? matches[active] : matches.length === 1 && needle ? matches[0] : undefined;
            if (city) choose(city);
          } else if (event.key === "Escape" && shown) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            setActive(-1);
          }
        }}
        onBlur={() => {
          setOpen(false);
          setActive(-1);
          const exact = CITIES.find((c) => c.toLowerCase() === needle && !exclude.includes(c));
          if (exact && exact !== value && !clearOnSelect) choose(exact);
          else setText(value);
        }}
      />
      {shown ? (
        <ul id={`${id}-list`} role="listbox" aria-label="Towns" className="listbox">
          {matches.map((city, index) => (
            <li
              key={city}
              id={`${id}-o${index}`}
              role="option"
              aria-selected={index === active}
              className={index === active ? "is-active" : undefined}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(city);
              }}
            >
              {city}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
