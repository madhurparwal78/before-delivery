import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { CHAPTER_TITLES } from "../../../shared/copy.js";
import { CHAPTERS, type Chapter, type PublicBoxState } from "../../../shared/domain.js";
import { ApiFailure, get } from "../api.js";
import { Link } from "../router.js";
import { goToChapter } from "../state/scroll.js";
import { LABELS, searchCount } from "./copy.js";

/** Search of the tale and the shelf: results as you type, reachable from the box by Arrow Down. */

const DEBOUNCE_MS = 100;
const MAX_QUERY = 100;

type Hit =
  | { kind: "passage"; passageId: string; chapter: Chapter; excerpt: string }
  | { kind: "box"; number: number; plate: string; state: PublicBoxState };

const isChapter = (value: string): value is Chapter => (CHAPTERS as readonly string[]).includes(value);

export const Search = () => {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [status, setStatus] = useState("");
  const ticket = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    ticket.current += 1;
    const mine = ticket.current;
    const text = query.trim().slice(0, MAX_QUERY);
    if (text === "") {
      setHits([]);
      setStatus("");
      return undefined;
    }
    const wait = window.setTimeout(async () => {
      try {
        const { body } = await get<{ hits: Hit[] }>(`/api/search?q=${encodeURIComponent(text)}`);
        if (mine !== ticket.current) return;
        setHits(body.hits);
        setStatus(searchCount(body.hits.length));
      } catch (failure) {
        if (mine !== ticket.current) return;
        setHits([]);
        setStatus(failure instanceof ApiFailure ? failure.message : "");
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(wait);
  }, [query]);

  const links = (): HTMLAnchorElement[] => [...(list.current?.querySelectorAll("a") ?? [])];

  const fromInput = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      links()[0]?.focus();
    } else if (event.key === "Escape") {
      setQuery("");
    }
  };

  const fromList = (event: KeyboardEvent<HTMLUListElement>): void => {
    const all = links();
    const at = all.findIndex((anchor) => anchor === document.activeElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      all[Math.min(all.length - 1, at + 1)]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (at <= 0) input.current?.focus();
      else all[at - 1]?.focus();
    } else if (event.key === "Escape") {
      setQuery("");
      input.current?.focus();
    }
  };

  const jump = (event: MouseEvent, chapter: Chapter): void => {
    event.preventDefault();
    goToChapter(chapter);
    setQuery("");
    input.current?.focus();
  };

  return (
    <div role="search" className="search">
      <input
        ref={input}
        type="search"
        className="search__field"
        data-motion="focus"
        aria-label={LABELS.search.field}
        placeholder={LABELS.search.field}
        autoComplete="off"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={fromInput}
      />
      <ul ref={list} aria-label={LABELS.search.results} className="search__results" onKeyDown={fromList}>
        {hits.map((hit) =>
          hit.kind === "passage" && isChapter(hit.chapter) ? (
            <li key={hit.passageId}>
              <a href="/" onClick={(event) => jump(event, hit.chapter)}>
                <span className="search__where">{CHAPTER_TITLES[hit.chapter]}</span>
                <span>{hit.excerpt}</span>
              </a>
            </li>
          ) : hit.kind === "box" ? (
            <li key={`box-${hit.number}`}>
              <Link href={`/box/${hit.number}`}>
                <span className="search__where">Box {hit.number}</span>
                <span>
                  {hit.plate}, {hit.state}
                </span>
              </Link>
            </li>
          ) : null,
        )}
      </ul>
      <div role="status" aria-label={LABELS.search.status} className="search__status">
        {status}
      </div>
    </div>
  );
};
