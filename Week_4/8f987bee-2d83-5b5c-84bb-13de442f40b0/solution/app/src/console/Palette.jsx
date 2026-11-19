import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useModal } from "../lib/dialog.js";
import { api } from "./api.js";
import { mayOpen, PAGES } from "./pages.js";
import { useConsole } from "./context.js";

// Control+K / Command+K: search connections and pages; arrows move the highlight, Enter opens, Escape returns focus.
export default function Palette({ onClose }) {
  const navigate = useNavigate();
  const { user } = useConsole();
  const input = useRef(null);
  const ref = useModal(true, onClose, input);
  const [query, setQuery] = useState("");
  const [connections, setConnections] = useState([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    api("/api/connections").then((result) => {
      if (result.ok) setConnections(result.body.connections);
    });
  }, []);

  const options = useMemo(() => {
    const text = query.trim().toLowerCase();
    const pages = [PAGES[0], { to: "/app/connections/new", label: "New connection" }, ...PAGES.slice(1)]
      .filter((page) => mayOpen(page.to, user.role))
      .map((page) => ({ id: page.to, label: page.label, hint: "Page", to: page.to }));
    const found = connections.map((c) => ({ id: c.id, label: c.name, hint: "Connection", to: `/app/connections/${c.id}` }));
    return [...found, ...pages].filter((option) => option.label.toLowerCase().includes(text)).slice(0, 12);
  }, [query, connections, user.role]);

  const open = (option) => {
    onClose();
    navigate(option.to);
  };
  const onKeyDown = (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (options.length ? (index + step + options.length) % options.length : 0));
    } else if (event.key === "Enter" && options[active]) {
      event.preventDefault();
      open(options[active]);
    }
  };

  return (
    <dialog ref={ref} className="palette" aria-label="Command palette">
      <input ref={input} type="text" className="input palette-input" aria-label="Search commands" placeholder="Search connections and pages"
        aria-controls="palette-options" aria-autocomplete="list"
        aria-activedescendant={options[active] ? `palette-${options[active].id.replace(/\W/g, "-")}` : undefined}
        value={query} onChange={(e) => { setQuery(e.target.value); setActive(0); }} onKeyDown={onKeyDown} />
      <ul id="palette-options" role="listbox" aria-label="Matches" className="palette-options">
        {options.map((option, index) => (
          <li key={option.id} id={`palette-${option.id.replace(/\W/g, "-")}`} role="option" aria-selected={index === active}
            className={index === active ? "active" : ""} onMouseEnter={() => setActive(index)} onClick={() => open(option)}>
            <span>{option.label}</span><span className="label">{option.hint}</span>
          </li>
        ))}
        {!options.length && <li role="option" aria-selected="false" aria-disabled="true" className="palette-empty">No matches</li>}
      </ul>
    </dialog>
  );
}
