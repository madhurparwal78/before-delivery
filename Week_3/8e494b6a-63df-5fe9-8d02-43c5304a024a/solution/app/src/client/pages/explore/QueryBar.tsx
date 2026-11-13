// The query bar row: stream, the pill-shaped query combobox with suggestions, and the time range control.
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { api, query, ApiFailure } from "../../lib/api";

interface Item { label: string; insert: string; count?: number }
type Kind = "field" | "operator" | "value" | "none";

export interface QueryBarHandle {
  focus: () => void;
  caretTo: (position: number) => void;
}

interface Props {
  streams: string[];
  stream: string;
  q: string;
  from: string;
  to: string;
  rangeText: string;
  /** On a phone the range controls sit in their own row. */
  compact: boolean;
  error: string | null;
  onStream: (name: string) => void;
  onRun: (q: string) => void;
  onRange: () => void;
}

/** Where the typed fragment before the caret starts, by the kind of suggestion offered. */
function fragmentStart(kind: Kind, before: string): number {
  if (kind === "field") return before.length - (/[A-Za-z0-9_.@-]*$/.exec(before)?.[0].length ?? 0);
  if (kind === "value") return before.length - (/(?::|>=|<=|>|<)("[^"]*|[^\s()"{}]*)$/.exec(before)?.[1]?.length ?? 0);
  return before.length;
}

export const QueryBar = forwardRef<QueryBarHandle, Props>(function QueryBar({ streams, stream, q, from, to, rangeText, compact, error, onStream, onRun, onRange }, handle) {
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(q);
  const [items, setItems] = useState<Item[]>([]);
  const [kind, setKind] = useState<Kind>("none");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const caret = useRef<number | null>(null);
  const sequence = useRef(0);

  useImperativeHandle(handle, () => ({
    focus: () => input.current?.focus(),
    caretTo: (position) => input.current?.setSelectionRange(position, position),
  }));

  useEffect(() => setDraft(q), [q]);
  useLayoutEffect(() => {
    if (caret.current !== null && input.current) {
      input.current.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  });

  const refresh = async (text: string, position: number): Promise<void> => {
    const token = ++sequence.current;
    const cursor = Array.from(text.slice(0, position)).length;
    try {
      const found = await api.get<{ kind: Kind; items: Item[] }>(`/api/suggest${query({ stream, q: text, cursor, from, to })}`);
      if (token !== sequence.current) return;
      setActive((current) => (current >= 0 && found.items[current]?.label === items[current]?.label && found.items.length === items.length ? current : -1));
      setItems(found.items);
      setKind(found.kind);
    } catch (failure) {
      if (failure instanceof ApiFailure && token === sequence.current) setItems([]);
    }
  };

  const accept = (item: Item): void => {
    const position = input.current?.selectionStart ?? draft.length;
    const before = draft.slice(0, position);
    const start = fragmentStart(kind, before);
    const text = draft.slice(0, start) + item.insert + draft.slice(position);
    const next = start + item.insert.length;
    caret.current = next;
    setDraft(text);
    setActive(-1);
    void refresh(text, next);
  };

  const shown = open && items.length > 0 && stream !== "";
  return (
    <div className="query-row">
      <div className="field stream-field">
        <label htmlFor="stream-select" className="sr-only">Stream</label>
        <select id="stream-select" value={stream} onChange={(event) => onStream(event.target.value)} aria-label="Stream">
          {streams.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </div>
      <div className="query-pill">
        <div className="query-input">
          <input
            ref={input}
            type="text"
            role="combobox"
            aria-label="Query"
            aria-autocomplete="list"
            aria-expanded={shown}
            aria-controls="suggest-list"
            aria-activedescendant={shown && active >= 0 ? `suggest-opt-${active}` : undefined}
            aria-invalid={error ? true : undefined}
            className="mono"
            placeholder="service:web AND level:warn"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setOpen(true);
              void refresh(event.target.value, event.target.selectionStart ?? event.target.value.length);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && shown) {
                event.preventDefault();
                setActive((active + 1) % items.length);
              } else if (event.key === "ArrowUp" && shown) {
                event.preventDefault();
                setActive(active <= 0 ? items.length - 1 : active - 1);
              } else if (event.key === "Tab" && shown && active >= 0) {
                event.preventDefault();
                accept(items[active] as Item);
              } else if (event.key === "Enter") {
                event.preventDefault();
                setOpen(false);
                setActive(-1);
                onRun(draft);
              } else if (event.key === "Escape") {
                setOpen(false);
                setActive(-1);
              }
            }}
            onKeyUp={(event) => {
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                setOpen(true);
                void refresh(draft, event.currentTarget.selectionStart ?? draft.length);
              }
            }}
            onClick={(event) => {
              setOpen(true);
              void refresh(draft, event.currentTarget.selectionStart ?? draft.length);
            }}
            onBlur={() => setOpen(false)}
          />
          {shown ? (
            <ul id="suggest-list" role="listbox" aria-label="Suggestions" className="suggestions">
              {items.map((item, k) => (
                <li key={`${item.label}:${k}`} id={`suggest-opt-${k}`} role="option" aria-label={item.label} aria-selected={k === active} className={k === active ? "active" : ""} onMouseDown={(event) => { event.preventDefault(); accept(item); }}>
                  <span className="mono">{item.label}</span>
                  {item.count !== undefined ? <span className="suggest-count mono muted" aria-hidden="true">{item.count}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {compact ? null : <button type="button" className="btn btn-outline range-button" aria-haspopup="dialog" onClick={onRange}>Time range</button>}
        {compact ? null : <span className="range-text mono small">{rangeText}</span>}
      </div>
    </div>
  );
});
