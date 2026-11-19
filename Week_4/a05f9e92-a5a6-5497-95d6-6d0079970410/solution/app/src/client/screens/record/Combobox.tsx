import { useId, useState, type KeyboardEvent } from "react";

export interface Choice {
  value: string;
  label: string;
}

interface Props {
  id: string;
  choices: Choice[];
  /** The selected value, or null when nothing is chosen. */
  value: string | null;
  /** The text shown for the selected value when it is not among the choices. */
  shown: string;
  required: boolean;
  describedBy: string | undefined;
  invalid: boolean;
  /** Text that matches no choice stays as the value, for a person whose list is only a hint; the server checks it on save. */
  keepTyped?: boolean;
  onPick(value: string | null): void;
}

/** An ARIA combobox: typing filters the list, Down opens and moves, Enter picks, Escape closes. */
export function Combobox({ id, choices, value, shown, required, describedBy, invalid, keepTyped = false, onPick }: Props): JSX.Element {
  const listId = useId();
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selectedLabel = choices.find((c) => c.value === value)?.label ?? shown;
  const needle = (keepTyped ? (value ?? "") : (query ?? "")).trim().toLowerCase();
  const visible = choices.filter((c) => c.label.toLowerCase().includes(needle));
  const optionId = (index: number): string => `${listId}-${index}`;

  const pick = (choice: Choice): void => {
    setQuery(null);
    setOpen(false);
    onPick(choice.value);
  };

  const settle = (): void => {
    setOpen(false);
    if (keepTyped || query === null) return;
    const typed = query.trim();
    const exact = choices.find((c) => c.label.toLowerCase() === typed.toLowerCase());
    if (typed === "") onPick(null);
    else if (exact) onPick(exact.value);
    setQuery(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(0);
      } else setActive(Math.min(active + 1, visible.length - 1));
    } else if (event.key === "ArrowUp" && open) {
      event.preventDefault();
      setActive(Math.max(active - 1, 0));
    } else if (event.key === "Enter" && open) {
      const choice = visible[active];
      if (choice || !keepTyped) event.preventDefault();
      if (choice) pick(choice);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setQuery(null);
    }
  };

  const expanded = open && visible.length > 0;
  return (
    <div className="rf-combo">
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={expanded ? optionId(active) : undefined}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        value={keepTyped ? (value ?? "") : (query ?? selectedLabel)}
        onChange={(event) => {
          if (keepTyped) onPick(event.target.value);
          else setQuery(event.target.value);
          setOpen(true);
          setActive(0);
        }}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onBlur={settle}
      />
      <ul id={listId} role="listbox" aria-label="Matches" hidden={!expanded} className="rf-options">
        {expanded
          ? visible.map((choice, index) => (
              <li
                key={choice.value}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                className={index === active ? "rf-option rf-option-active" : "rf-option"}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(choice)}
              >
                {choice.label}
              </li>
            ))
          : null}
      </ul>
    </div>
  );
}
