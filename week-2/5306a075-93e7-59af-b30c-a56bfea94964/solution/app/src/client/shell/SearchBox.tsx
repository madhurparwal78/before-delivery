// Global search: a combobox over grouped results (Notes, Companies, Features), snippets shown as text.
import { Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { SearchResults } from "../../shared/api.js";
import { api } from "../api.js";
import { navigate } from "../router.js";

interface Option { id: string; href: string; label: string; detail: string }

export function SearchBox() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const latest = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      return;
    }
    const ticket = ++latest.current;
    const timer = setTimeout(() => {
      api.get<SearchResults>(`/api/search?q=${encodeURIComponent(q)}`).then((found) => {
        if (ticket === latest.current) {
          setResults(found);
          setActive(-1);
        }
      }, () => undefined);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const groups: { label: string; options: Option[] }[] = results
    ? [
      { label: "Notes", options: results.notes.map((n) => ({ id: n.id, href: `/inbox/${n.id}`, label: n.title, detail: n.snippet })) },
      { label: "Companies", options: results.companies.map((c) => ({ id: c.id, href: `/companies/${c.id}`, label: c.name, detail: c.domains.join(", ") })) },
      { label: "Features", options: results.features.map((f) => ({ id: f.id, href: `/features/${f.id}`, label: f.name, detail: `${f.insightCount} insights · ${f.companyCount} companies` })) },
    ].filter((g) => g.options.length > 0)
    : [];
  const flat = groups.flatMap((g) => g.options);
  const open = results !== null;

  const choose = (option: Option): void => {
    setQuery("");
    setResults(null);
    navigate(option.href);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown" && flat.length > 0) {
      event.preventDefault();
      setActive((i) => (i + 1) % flat.length);
    } else if (event.key === "ArrowUp" && flat.length > 0) {
      event.preventDefault();
      setActive((i) => (i <= 0 ? flat.length - 1 : i - 1));
    } else if (event.key === "Enter" && flat[active]) {
      event.preventDefault();
      choose(flat[active]);
    } else if (event.key === "Escape") {
      setQuery("");
      setResults(null);
    }
  };

  let index = -1;
  return (
    <div className="search">
      <Search aria-hidden="true" size={16} className="search-icon" />
      <input
        type="text"
        role="combobox"
        aria-label="Search workspace"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        placeholder="Search workspace"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setResults(null), 200)}
      />
      {open && flat.length === 0 && <p className="search-results search-empty">No matches in this workspace.</p>}
      {open && flat.length > 0 && <div id={listId} role="listbox" aria-label="Search results" className="search-results">
        {groups.map((group) => (
          <div key={group.label} role="group" aria-label={group.label}>
            <p className="search-group" aria-hidden="true">{group.label}</p>
            {group.options.map((option) => {
              index += 1;
              const i = index;
              return (
                <div key={option.id} id={`${listId}-${i}`} role="option" aria-selected={i === active} className="search-option"
                  onMouseDown={(event) => { event.preventDefault(); choose(option); }}>
                  <span className="search-option-title">{option.label}</span>
                  <span className="search-option-detail">{option.detail}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>}
    </div>
  );
}
