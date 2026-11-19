// The people picker (brief: Interactions, People picker): searches the directory as the person types, works by
// keyboard as a combobox, and shows each person's name, firm and kind.
import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError, query } from "../api";
import { announce } from "../announce";
import { PICKER_OUTAGE } from "../copy";
import type { Person, PersonKind } from "../../shared/api";

const PAUSE_MS = 250;

interface Props {
  label: string;
  kind: PersonKind;
  exclude?: string[];
  picked: Person | null;
  onPick: (person: Person | null) => void;
  error?: string;
  autoFocus?: boolean;
}

function initials(name: string): string {
  return name.split(/\s+/).map((p) => p[0] ?? "").join("").slice(0, 2).toUpperCase();
}

export function PeoplePicker({ label, kind, exclude = [], picked, onPick, error }: Props) {
  const [text, setText] = useState(picked?.name ?? "");
  const [people, setPeople] = useState<Person[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [outage, setOutage] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const asked = useRef(0);
  const listId = useId();
  const errorId = useId();
  const statusId = useId();

  useEffect(() => {
    if (!picked) setText("");
  }, [picked]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const search = (q: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) {
      setPeople([]);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(() => {
      const ticket = ++asked.current;
      api<{ people: Person[] }>("GET", `/api/people${query({ q: q.trim().slice(0, 100), kind })}`).then((body) => {
        if (ticket !== asked.current) return;
        setOutage(false);
        const found = body.people.filter((p) => p.kind === kind && !exclude.includes(p.id));
        setPeople(found);
        setActive(-1);
        setOpen(true);
      }, (failure: unknown) => {
        if (ticket !== asked.current || !(failure instanceof ApiError)) return;
        if (failure.code === "directory_unavailable" || failure.status === 0) {
          setOutage(true);
          setPeople([]);
          setOpen(false);
          announce(PICKER_OUTAGE);
        }
      });
    }, PAUSE_MS);
  };

  const choose = (person: Person) => {
    onPick(person);
    setText(person.name);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open && people.length) setOpen(true);
      setActive((i) => Math.min(people.length - 1, i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      const person = people[active] ?? (people.length === 1 ? people[0] : undefined);
      if (person) choose(person);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  };

  const optionId = (i: number) => `${listId}-${i}`;
  return (
    <div className="picker">
      <input type="text" role="combobox" aria-label={label} aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-describedby={[error ? errorId : "", outage ? statusId : ""].filter(Boolean).join(" ") || undefined}
        aria-invalid={error ? true : undefined}
        autoComplete="off" value={text} className="field-input"
        placeholder={kind === "partner" ? "Type a partner's name" : "Type a colleague's name"}
        onChange={(e) => {
          setText(e.target.value);
          if (picked) onPick(null);
          search(e.target.value);
        }}
        onFocus={() => {
          if (outage && text.trim()) search(text);
        }}
        onKeyDown={onKeyDown} />
      <div id={listId} role="listbox" aria-label="People" className="picker-list" hidden={!open}>
        {people.map((person, i) => (
          <div key={person.id} id={optionId(i)} role="option" aria-selected={i === active} className="picker-option"
            onMouseDown={(e) => e.preventDefault()} onClick={() => choose(person)}>
            <span className="avatar" aria-hidden="true">{initials(person.name)}</span>
            <span className="picker-name">{person.name} — {person.firm}</span>
            <span className="tag">{person.kind === "staff" ? "Staff" : "Partner"}</span>
          </div>
        ))}
        {open && !people.length && <div className="picker-empty">No one matches.</div>}
      </div>
      {outage && <p id={statusId} className="field-note warn">{PICKER_OUTAGE}</p>}
      {error && <p id={errorId} className="field-error">{error}</p>}
    </div>
  );
}
