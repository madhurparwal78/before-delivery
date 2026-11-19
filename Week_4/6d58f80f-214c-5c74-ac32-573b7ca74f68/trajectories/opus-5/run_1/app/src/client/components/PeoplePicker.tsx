import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Person } from '../../shared/types.js';
import { ApiFailure, api } from '../lib/api.js';
import { DIRECTORY_PICKER_OUTAGE } from '../../shared/copy.js';
import { initials } from '../lib/format.js';

interface PeoplePickerProps {
  label: string;
  kind: 'staff' | 'partner';
  excludeIds?: string[];
  value: Person | null;
  onPick: (person: Person | null) => void;
}

export const PeoplePicker = ({
  label,
  kind,
  excludeIds = [],
  value,
  onPick,
}: PeoplePickerProps): JSX.Element => {
  const [text, setText] = useState(value === null ? '' : `${value.name} — ${value.firm}`);
  const [people, setPeople] = useState<Person[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [outage, setOutage] = useState(false);
  const timer = useRef<number | null>(null);
  const listId = `people-${label.replace(/\s+/g, '-').toLowerCase()}`;

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const search = (query: string): void => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (query.trim() === '') {
      setPeople([]);
      setOpen(false);
      return;
    }
    timer.current = window.setTimeout(() => {
      void (async () => {
        try {
          const found = await api.people(query.trim(), kind);
          setOutage(false);
          setPeople(found.people.filter((person) => !excludeIds.includes(person.id)));
          setOpen(true);
          setActive(-1);
        } catch (error) {
          if (error instanceof ApiFailure && error.status === 503) {
            setOutage(true);
            setPeople([]);
            setOpen(false);
            return;
          }
          setPeople([]);
        }
      })();
    }, 250);
  };

  const choose = (person: Person): void => {
    onPick(person);
    setText(`${person.name} — ${person.firm}`);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open && people.length > 0) {
        setOpen(true);
        setActive(0);
        return;
      }
      setActive((index) => Math.min(index + 1, people.length - 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      const person = people[active] ?? people[0];
      if (open && person !== undefined) {
        event.preventDefault();
        choose(person);
      }
      return;
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div className="field">
      <label htmlFor={`${listId}-input`}>{label}</label>
      <input
        id={`${listId}-input`}
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-option-${active}` : undefined}
        autoComplete="off"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          onPick(null);
          search(event.target.value);
        }}
        onKeyDown={onKeyDown}
      />
      {outage ? <p className="field-error">{DIRECTORY_PICKER_OUTAGE}</p> : null}
      <ul role="listbox" aria-label="People" id={listId} className="combo-list" hidden={!open}>
        {people.map((person, index) => (
          <li
            key={person.id}
            id={`${listId}-option-${index}`}
            role="option"
            aria-label={`${person.name} — ${person.firm}`}
            aria-selected={index === active}
            onMouseDown={(event) => {
              event.preventDefault();
              choose(person);
            }}
          >
            <span className="avatar" aria-hidden="true">
              {initials(person.name)}
            </span>
            <span>
              {person.name} — {person.firm}
            </span>
            <span className="badge">{person.kind === 'staff' ? 'Staff' : 'Partner'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};
