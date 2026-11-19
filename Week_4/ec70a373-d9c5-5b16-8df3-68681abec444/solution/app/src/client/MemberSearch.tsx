// An autocomplete combobox over member search: two characters offer up to ten matches.
import { useEffect, useId, useState, type ReactNode } from "react";
import type { MemberMatch } from "../shared/api.ts";
import { api } from "./api.ts";
import { useLatestRequest } from "./ui.tsx";

interface MemberSearchProps {
  label: string;
  value: string;
  onText: (text: string) => void;
  onPick: (member: MemberMatch) => void;
}

export function MemberSearch({ label, value, onText, onPick }: MemberSearchProps): ReactNode {
  const id = useId();
  const [matches, setMatches] = useState<MemberMatch[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const beginSearch = useLatestRequest();

  // Every change of the text makes every earlier search stale; the list only shows matches for the current text.
  useEffect(() => {
    const isLatest = beginSearch();
    setMatches([]);
    setActive(-1);
    const text = value.trim();
    if (text.length < 2 || !open) return;
    void api<{ members: MemberMatch[] }>(`/api/members?q=${encodeURIComponent(text)}`).then((result) => {
      if (isLatest()) setMatches(result.ok ? result.data.members : []);
    });
  }, [value, open, beginSearch]);

  const pick = (member: MemberMatch): void => {
    onPick(member);
    setOpen(false);
    setMatches([]);
  };

  const listId = `${id}-list`;
  const expanded = open && matches.length > 0;
  return (
    <div className="combo">
      <label htmlFor={`${id}-input`}>{label}</label>
      <input
        id={`${id}-input`}
        role="combobox"
        type="text"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
        value={value}
        onChange={(event) => {
          onText(event.target.value);
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && matches.length) {
            event.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(matches.length - 1, i + 1));
          } else if (event.key === "ArrowUp" && matches.length) {
            event.preventDefault();
            setActive((i) => Math.max(0, i - 1));
          } else if (event.key === "Enter" && expanded && active >= 0) {
            event.preventDefault();
            const member = matches[active];
            if (member) pick(member);
          } else if (event.key === "Escape" && expanded) {
            event.preventDefault();
            setOpen(false);
          }
        }}
      />
      <ul id={listId} role="listbox" aria-label={`${label} matches`} className="combo-list" hidden={!expanded}>
        {matches.map((m, i) => (
          <li
            key={m.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            className={i === active ? "is-active" : undefined}
            onMouseDown={(event) => {
              event.preventDefault();
              pick(m);
            }}
          >
            <span className="combo-business">{m.business_name}</span> <span className="combo-contact">{m.contact_name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
