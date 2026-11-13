import type { Ref } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { COPY, rupees } from "../../shared/copy";
import type { SearchAnswer, SearchResult } from "../../shared/types";
import { ApiFailure, get, isAbort } from "../lib/net";

const DEBOUNCE_MS = 250;

export function PackSearch({ onChoose, onLimited, waitMessage, boxRef }: { onChoose: (r: SearchResult) => void; onLimited: (retryAfter: number, message: string) => void; waitMessage: string | null; boxRef: Ref<HTMLInputElement> }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState("");
  const token = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const control = useRef<AbortController | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const box = useRef<HTMLInputElement | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;
  const lastWait = useRef<string | null>(null);

  const clearAll = () => {
    token.current++;
    control.current?.abort();
    if (timer.current) clearTimeout(timer.current);
    setResults([]);
    setStatus("");
  };

  useEffect(() => {
    if (lastWait.current && !waitMessage && statusRef.current === lastWait.current) setStatus("");
    lastWait.current = waitMessage;
  }, [waitMessage]);

  const run = async (text: string) => {
    const mine = ++token.current;
    control.current?.abort();
    const ctl = (control.current = new AbortController());
    try {
      const answer = await get<SearchAnswer>(`/api/search?q=${encodeURIComponent(text)}`, { signal: ctl.signal });
      if (mine !== token.current) return;
      const inList = !!list.current?.contains(document.activeElement);
      setResults(answer.results);
      const n = answer.results.length;
      const tail = answer.searchState === "behind" ? COPY.searchBehind : answer.searchState === "down" ? COPY.searchDown : "";
      if (n > 0) setStatus(`${n === 1 ? "1 pack found." : `${n} packs found.`}${tail ? ` ${tail}` : ""}`);
      else setStatus(answer.searchState === "current" ? COPY.noMatch : tail);
      if (inList) box.current?.focus();
    } catch (error) {
      if (isAbort(error) || mine !== token.current) return;
      if (error instanceof ApiFailure && error.status === 429) {
        setResults([]);
        setStatus(error.body.message);
        onLimited(error.retryAfter ?? 1, error.body.message);
      }
    }
  };

  const onInput = (value: string) => {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    const trimmed = value.trim();
    if (!trimmed) {
      clearAll();
      return;
    }
    token.current++;
    control.current?.abort();
    timer.current = setTimeout(() => void run(trimmed), DEBOUNCE_MS);
  };

  const move = (e: KeyboardEvent, index: number) => {
    const buttons = Array.from(list.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      buttons[Math.min(index + 1, buttons.length - 1)]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (index === 0) {
        const b = box.current;
        b?.focus();
        b?.setSelectionRange(b.value.length, b.value.length);
      } else buttons[index - 1]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      box.current?.focus();
    }
  };

  return (
    <div class="search">
      <label for="find-a-pack">Find a pack</label>
      <input
        id="find-a-pack"
        ref={(el) => {
          box.current = el;
          if (typeof boxRef === "function") boxRef(el);
          else if (boxRef) (boxRef as { current: HTMLInputElement | null }).current = el;
        }}
        type="search"
        autocomplete="off"
        maxLength={80}
        value={query}
        aria-label="Find a pack"
        onInput={(e) => onInput((e.currentTarget as HTMLInputElement).value.slice(0, 80))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            list.current?.querySelector<HTMLButtonElement>("button")?.focus();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setQuery("");
            clearAll();
          }
        }}
      />
      <div role="status" aria-label="Search status" class="status">
        {status}
      </div>
      <ul ref={list} role="list" aria-label="Pack results" class="results">
        {results.map((r, i) => {
          const name = r.kind === "batch" ? `${r.batchCode} ${r.name} Rs ${rupees(r.retailPricePaise)}` : `${r.name} Rs ${rupees(r.retailPricePaise)}`;
          return (
            <li key={`${r.kind}-${r.batchCode ?? r.skuCode}`}>
              <button type="button" aria-label={name} onClick={() => onChoose(r)} onKeyDown={(e) => move(e, i)}>
                <span aria-hidden="true">{r.kind === "batch" ? `${r.batchCode} ${r.name}` : r.name}</span>
                <span aria-hidden="true" class="price">Rs {rupees(r.retailPricePaise)}</span>
              </button>
              <span class="source">{r.sourceNotice ? `${r.sourceNotice.number} v${r.sourceNotice.version}` : "Launch print"}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
