import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { SuggestResponse } from "../../shared/api";
import { api } from "../lib/api";
import { navigate, useParams, usePath, withQuery } from "../lib/router";

// Every keystroke asks the server; only the reply to the newest text is shown. No waiting timer.

export function SearchBox() {
  const listId = useId();
  const [text, setText] = useState("");
  const [typed, setTyped] = useState("");
  const [options, setOptions] = useState<SuggestResponse["suggestions"]>([]);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const newest = useRef(0);
  const path = usePath();
  const params = useParams();
  const urlText = path.startsWith("/collections/") ? (params.get("q") ?? "") : "";

  useEffect(() => {
    setText(urlText);
    setTyped(urlText);
  }, [urlText]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if (event.key === "/" && !editing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        input.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const ask = (value: string) => {
    newest.current += 1;
    const mine = newest.current;
    if (!value.trim()) {
      setOptions([]);
      setOpen(false);
      return;
    }
    api
      .get<SuggestResponse>(`/api/search/suggest?q=${encodeURIComponent(value)}`)
      .then((reply) => {
        if (mine !== newest.current) return;
        setOptions(reply.suggestions);
        setOpen(reply.suggestions.length > 0);
        setActive(-1);
      })
      .catch(() => {
        if (mine === newest.current) setOpen(false);
      });
  };

  const onChange = (value: string) => {
    setText(value);
    setTyped(value);
    ask(value);
  };

  const close = () => {
    newest.current += 1;
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!options.length) return;
      event.preventDefault();
      setOpen(true);
      const count = options.length;
      const next = event.key === "ArrowDown" ? (active + 1 >= count ? -1 : active + 1) : active - 1 < -1 ? count - 1 : active - 1;
      setActive(next);
      setText(next < 0 ? typed : (options[next]?.name ?? typed));
    } else if (event.key === "Escape") {
      close();
      setText(typed);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const chosen = active >= 0 ? options[active] : undefined;
      close();
      if (chosen) {
        navigate(`/products/${chosen.slug}`);
      } else if (typed.trim()) {
        navigate(withQuery("/collections/all", { q: typed.trim() }), { replace: path.startsWith("/collections/") });
      }
    }
  };

  return (
    <div className="search" role="search">
      <input
        ref={input}
        type="text"
        role="combobox"
        aria-label="Search products"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        className="search-input"
        placeholder="Search"
        value={text}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={close}
      />
      {open && (
        <ul id={listId} role="listbox" aria-label="Suggestions" className="suggestions">
          {options.map((option, index) => (
            <li
              key={option.slug}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={index === active ? "is-active" : undefined}
              onMouseDown={(event) => {
                event.preventDefault();
                close();
                navigate(`/products/${option.slug}`);
              }}
            >
              {option.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
