import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { insert, suggest, typedAt } from './suggestions.ts';
import type { Suggestion, Typed } from './suggestions.ts';

interface FormulaBoxProps {
  value: string;
  onChange: (value: string) => void;
  /** every name a formula may use as `[Name]` */
  names: readonly string[];
  error?: string | null;
}

interface Open {
  typed: Typed;
  choices: Suggestion[];
  /** index of the active option, or -1 until an arrow key picks one */
  active: number;
}

/** A multi-line formula box with a keyboard-driven suggestion list; focus never leaves the box. */
export function FormulaBox({ value, onChange, names, error }: FormulaBoxProps) {
  const id = useId();
  const listId = `${id}-list`;
  const errorId = `${id}-error`;
  const box = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const optionId = (index: number) => `${id}-option-${index}`;

  useEffect(() => {
    if (open && open.active >= 0) document.getElementById(optionId(open.active))?.scrollIntoView({ block: 'nearest' });
  }, [open?.active]);

  const listFor = (text: string, caret: number): Open | null => {
    const typed = typedAt(text, caret);
    const choices = typed ? suggest(typed, names) : [];
    return typed && choices.length > 0 ? { typed, choices, active: -1 } : null;
  };

  const choose = (choice: Suggestion) => {
    const element = box.current;
    if (!element || !open) return;
    const next = insert(value, element.selectionStart, open.typed, choice);
    flushSync(() => {
      onChange(next.text);
      setOpen(null);
    });
    element.setSelectionRange(next.caret, next.caret);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open) return;
    const last = open.choices.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setOpen({ ...open, active: Math.min(open.active + 1, last) });
        break;
      case 'ArrowUp':
        event.preventDefault();
        setOpen({ ...open, active: open.active < 0 ? last : Math.max(open.active - 1, 0) });
        break;
      case 'Enter': {
        event.preventDefault();
        const choice = open.choices[Math.max(open.active, 0)];
        if (choice) choose(choice);
        break;
      }
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        setOpen(null);
        break;
      case 'Tab':
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'Home':
      case 'End':
        setOpen(null);
        break;
    }
  };

  return (
    <div className="field formula-field">
      <label htmlFor={id} className="field-label">
        Formula
      </label>
      <textarea
        ref={box}
        id={id}
        className="control formula-box"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open !== null}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && open.active >= 0 ? optionId(open.active) : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        spellCheck={false}
        autoComplete="off"
        rows={4}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(listFor(event.target.value, event.target.selectionStart));
        }}
        onKeyDown={onKeyDown}
        onClick={() => setOpen(null)}
        onBlur={() => setOpen(null)}
      />
      {open ? (
        <ul id={listId} role="listbox" aria-label="Suggestions" className="suggestions">
          {open.choices.map((choice, index) => (
            <li
              key={`${choice.kind}-${choice.name}`}
              id={optionId(index)}
              role="option"
              aria-selected={index === open.active}
              className="suggestion"
              data-kind={choice.kind}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(choice);
              }}
            >
              {choice.name}
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p id={errorId} className="field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
