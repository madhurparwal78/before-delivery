import { useId, useState, type KeyboardEvent } from "react";

export interface Choice {
  id: string;
  label: string;
}

interface Props {
  label: string;
  choices: Choice[];
  text: string;
  onText: (text: string) => void;
  onPick: (choice: Choice) => void;
  onNoMatch?: (text: string) => void;
}

export function Combobox({ label, choices, text, onText, onPick, onNoMatch }: Props): React.JSX.Element {
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const open = focused && choices.length > 0;
  const current = choices[Math.min(active, choices.length - 1)];

  const press = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (index + step + choices.length) % Math.max(choices.length, 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (current) onPick(current);
      else onNoMatch?.(text);
    }
  };

  return (
    <div className="combobox">
      <input
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && current ? `${listId}-${current.id}` : undefined}
        autoComplete="off"
        spellCheck={false}
        value={text}
        onChange={(event) => {
          setActive(0);
          onText(event.target.value);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={press}
      />
      <ul id={listId} role="listbox" aria-label={`${label} choices`} hidden={!open}>
        {choices.map((choice) => (
          <li
            key={choice.id}
            id={`${listId}-${choice.id}`}
            role="option"
            aria-selected={choice === current}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(choice)}
          >
            {choice.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
