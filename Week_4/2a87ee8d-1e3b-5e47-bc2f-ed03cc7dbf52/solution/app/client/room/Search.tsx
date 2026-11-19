import { useEffect, useRef, useState } from "react";
import { Search as SearchIcon } from "lucide-react";
import { api, failureText } from "../api.js";

interface Result {
  noteId: string;
  frameId: string;
  text: string;
}

export function SearchBox({ workshopId, onPick, autoFocus }: { workshopId: string; onPick: (noteId: string) => void; autoFocus: boolean }) {
  const [q, setQ] = useState("");
  const [state, setState] = useState<{ kind: "idle" } | { kind: "busy" } | { kind: "done"; query: string; results: Result[] } | { kind: "error"; text: string }>({ kind: "idle" });
  const timer = useRef(0);
  const box = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (autoFocus) box.current?.focus();
  }, [autoFocus]);

  const run = async (query: string) => {
    clearTimeout(timer.current);
    if (query.trim() === "") {
      setState({ kind: "idle" });
      return;
    }
    const mine = ++seq.current;
    setState({ kind: "busy" });
    try {
      const r = await api<{ results: Result[] }>("GET", `/api/workshops/${workshopId}/search?q=${encodeURIComponent(query)}`);
      if (mine === seq.current) setState({ kind: "done", query: query.trim(), results: r.results });
    } catch (e) {
      if (mine === seq.current) setState({ kind: "error", text: failureText(e, "You're offline — search needs a connection.") });
    }
  };

  return (
    <form role="search" className="search" onSubmit={(e) => e.preventDefault()}>
      <SearchIcon aria-hidden="true" size={18} strokeWidth={1.75} className="search-icon" />
      <input
        ref={box}
        type="search"
        aria-label="Search notes"
        placeholder="Search notes"
        value={q}
        aria-describedby={state.kind === "error" ? "search-error" : undefined}
        onChange={(e) => {
          setQ(e.target.value);
          clearTimeout(timer.current);
          const value = e.target.value;
          timer.current = window.setTimeout(() => void run(value), 333);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void run(q);
          } else if (e.key === "Escape") {
            e.preventDefault();
            clearTimeout(timer.current);
            setQ("");
            setState({ kind: "idle" });
          }
        }}
      />
      {state.kind === "error" && (
        <p id="search-error" className="field-message search-panel">
          {state.text}
        </p>
      )}
      {state.kind === "busy" && <p className="search-panel muted">Searching…</p>}
      {state.kind === "done" && state.results.length === 0 && <p className="search-panel">No notes match “{state.query}”.</p>}
      <ul aria-label="Search results" className={state.kind === "done" && state.results.length ? "search-panel search-results" : "search-results"}>
        {state.kind === "done" &&
          state.results.map((r) => (
            <li key={r.noteId}>
              <button
                type="button"
                className="search-result"
                onClick={() => {
                  setState({ kind: "idle" });
                  onPick(r.noteId);
                }}
              >
                {r.text}
              </button>
            </li>
          ))}
      </ul>
    </form>
  );
}
