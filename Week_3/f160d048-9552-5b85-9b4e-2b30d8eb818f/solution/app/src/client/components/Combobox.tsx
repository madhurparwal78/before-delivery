import { useEffect, useId, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { announce } from "../announce";
import { FieldError } from "./ui";

type Option = { id: string; label: string };

type Props = {
  label: string;
  value: string;
  onChange: (text: string) => void;
  /** Called with an option picked by Enter or a click. */
  onPick: (option: Option) => void;
  /** Called by Enter when no option is active: the typed text is kept. */
  onEnter?: (text: string) => void;
  load: (text: string) => Promise<Option[]>;
  error?: string;
  inputRef?: Ref<HTMLInputElement>;
  placeholder?: string;
  className?: string;
};

/** A combobox that filters after the 300 ms debounce, announces the active option and restores the typed text on Escape. */
export function Combobox({ label, value, onChange, onPick, onEnter, load, error, inputRef, placeholder, className }: Props) {
  const id = useId();
  const [options, setOptions] = useState<Option[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const timer = useRef<number | undefined>(undefined);
  const request = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function schedule(text: string) {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const mine = ++request.current;
      void load(text).then((found) => {
        if (mine !== request.current) return;
        setOptions(found);
        setActive(-1);
        setOpen(found.length > 0);
      });
    }, 300);
  }

  function pick(option: Option) {
    window.clearTimeout(timer.current);
    request.current += 1;
    setOpen(false);
    setActive(-1);
    onPick(option);
  }

  function move(next: number) {
    const bounded = Math.max(0, Math.min(options.length - 1, next));
    setActive(bounded);
    const option = options[bounded];
    if (option) announce(`${option.label}, ${bounded + 1} of ${options.length}`);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (options.length === 0) return;
      event.preventDefault();
      setOpen(true);
      move(event.key === "ArrowDown" ? active + 1 : active - 1);
    } else if (event.key === "Enter") {
      const chosen = open ? options[active] : undefined;
      event.preventDefault();
      if (chosen) pick(chosen);
      else {
        window.clearTimeout(timer.current);
        request.current += 1;
        setOpen(false);
        onEnter?.(value);
      }
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setActive(-1);
    }
  }

  const listId = `${id}-list`;
  const showing = open && options.length > 0;
  return (
    <div className={`field combo ${className ?? ""}`}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        ref={inputRef}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showing}
        aria-controls={showing ? listId : undefined}
        aria-activedescendant={showing && active >= 0 ? `${id}-option-${active}` : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        aria-invalid={error ? true : undefined}
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          schedule(event.target.value);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
      />
      {showing ? (
        <ul className="listbox" role="listbox" id={listId} aria-label={`${label} suggestions`}>
          {options.map((option, index) => (
            <li
              key={option.id}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(option)}
            >
              {option.label}
            </li>
          ))}
        </ul>
      ) : null}
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </div>
  );
}
