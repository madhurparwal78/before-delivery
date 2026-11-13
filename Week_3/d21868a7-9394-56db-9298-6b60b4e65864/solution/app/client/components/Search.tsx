// The global search combobox: two or more characters list up to 8 suggestions within the caller's
// reach, refreshed as the user types and while the list is open.
import { Search as SearchIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { api, navigate } from "../lib.ts";
import type { Suggestion } from "../types.ts";

const TYPING_MS = 150;
const REFRESH_MS = 2000;

export function Search() {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;
  const query = useRef("");

  useEffect(() => {
    const q = text.trim();
    query.current = q;
    if (q.length < 2) {
      setItems([]);
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      const reply = await api<{ suggestions: Suggestion[] }>(`/api/search?q=${encodeURIComponent(q)}`);
      if (query.current !== q) return;
      if (reply.ok) setItems(reply.data.suggestions);
      timer = setTimeout(load, REFRESH_MS);
    };
    timer = setTimeout(load, TYPING_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const expanded = open && text.trim().length >= 2 && items.length > 0;

  const follow = (item: Suggestion) => {
    setOpen(false);
    setActive(-1);
    navigate(item.href);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (!items.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => (current + step + items.length) % items.length);
    } else if (event.key === "Enter" && expanded) {
      event.preventDefault();
      const chosen = items[active >= 0 ? active : 0];
      if (chosen) follow(chosen);
    } else if (event.key === "Escape" && expanded) {
      event.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  };

  return (
    <div className="search">
      <SearchIcon className="search-icon" size={18} aria-hidden="true" />
      <input
        type="text"
        role="combobox"
        aria-label="Search turnouts, growers and operators"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
        placeholder="Search turnouts, growers, operators"
        autoComplete="off"
        spellCheck={false}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
      />
      {expanded && (
        <ul id={listId} role="listbox" aria-label="Suggestions" className="suggestions">
          {items.map((item, index) => (
            <li
              key={`${item.kind}-${item.label}`}
              id={optionId(index)}
              role="option"
              aria-selected={index === active}
              className="suggestion"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => follow(item)}
            >
              <span className="suggestion-label">{item.label}</span>
              <span className="suggestion-detail">{item.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
