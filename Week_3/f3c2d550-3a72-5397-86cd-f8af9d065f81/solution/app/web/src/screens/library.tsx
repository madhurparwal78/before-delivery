import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { DailyPull, Library, Reference, SearchResult } from "../../../shared/api";
import type { SizeUnit } from "../../../shared/sizes";
import { identityLine, writtenDate } from "../../../shared/words";
import { api } from "../api";
import { ColourSelect } from "../controls";
import { COPY, useDeck } from "../deck";
import { displaySrcSet, useField, type Subject } from "../field";
import { useDocumentTitle, useRefetch } from "../hooks";

export function subjectOf(reference: Reference, unit: SizeUnit): Subject {
  return {
    key: reference.id,
    name: reference.title,
    size: reference.size_text[unit],
    swatch: reference.swatch,
    photo: reference.photo.display_url,
    srcSet: displaySrcSet(reference.photo.display_url, reference.photo),
  };
}

const SEARCH_DEBOUNCE_MS = 250;

function matchCopy(count: number): string {
  if (count === 0) return COPY.noMatches;
  return count === 1 ? "1 reference matches." : `${count} references match.`;
}

function flatten(library: Library | null): Reference[] {
  return library ? [...library.saved_today, ...library.earlier] : [];
}

function PullCard({ pull }: { pull: DailyPull | null }) {
  return (
    <section className="pull-card" aria-label="Daily Pull">
      <h2>Daily Pull</h2>
      {pull?.state === "picked" && pull.reference && (
        <p className="pull-line">
          <Link to={`/references/${pull.reference.id}`}>{identityLine(pull.reference)}</Link>
        </p>
      )}
      {pull?.state === "empty" && <p className="pull-line">Nothing to pull yet. Capture an object to start your Daily Pull.</p>}
      {pull?.state === "removed" && <p className="pull-line">Today&apos;s pull has left your library. A new one arrives at 06:00.</p>}
      {pull && (
        <>
          <p className="muted">Pulled for {writtenDate(pull.pull_day)}</p>
          <p className="muted">Next pull at 06:00, {pull.zone}</p>
        </>
      )}
    </section>
  );
}

interface RowListProps {
  references: Reference[];
  unit: SizeUnit;
  onLoad: (reference: Reference) => void;
}

function RowList({ references, unit, onLoad }: RowListProps) {
  return (
    <ul className="row-list">
      {references.map((reference) => (
        <li key={reference.id} className="row">
          <Link
            to={`/references/${reference.id}`}
            data-ref-id={reference.id}
            onFocus={() => onLoad(reference)}
            onMouseEnter={() => onLoad(reference)}
          >
            <span className="row-name">{reference.title}</span>
            <span className="row-meta">
              {reference.maker && <span>{reference.maker}</span>}
              <span className="size-line">{reference.size_text[unit]}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function LibraryScreen() {
  useDocumentTitle("Library");
  const field = useField();
  const { say, unit } = useDeck();
  const [library, setLibrary] = useState<Library | null>(null);
  const [pull, setPull] = useState<DailyPull | null>(null);
  const [results, setResults] = useState<Reference[] | null>(null);
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState("");
  const searchBox = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<Library | null>(null);
  const tileKey = useRef<string | null>(null);
  const typing = useRef(false);
  const searchSeq = useRef(0);
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    field.show(null, COPY.loading);
    return () => field.show(null);
  }, [field]);

  const syncTile = useCallback(
    (next: Library) => {
      const all = flatten(next);
      const shown = all.find((reference) => reference.id === tileKey.current);
      if (shown) {
        field.show(subjectOf(shown, unit));
        return;
      }
      const newest = all[0];
      if (newest) {
        tileKey.current = newest.id;
        field.show(subjectOf(newest, unit));
      } else {
        tileKey.current = null;
        field.show(null, next.saved_today.length + next.earlier.length === 0 ? COPY.emptyLibrary : null);
      }
    },
    [field, unit],
  );

  useRefetch(
    {
      load: () => api<Library>("GET", "/references"),
      onData: (next) => {
        const before = flatten(libraryRef.current);
        const after = flatten(next);
        const focused = document.activeElement?.closest<HTMLElement>("[data-ref-id]")?.dataset.refId;
        if (focused && !after.some((reference) => reference.id === focused)) {
          const at = before.findIndex((reference) => reference.id === focused);
          const survivors = [...before.slice(at + 1), ...before.slice(0, at).reverse()].filter((reference) =>
            after.some((candidate) => candidate.id === reference.id),
          );
          pendingFocus.current = survivors[0]?.id ?? "search";
        }
        libraryRef.current = next;
        setLibrary(next);
        syncTile(next);
      },
    },
    "library",
  );

  useRefetch({ load: () => api<DailyPull>("GET", "/daily-pull"), onData: setPull }, "pull");

  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const link = target === "search" ? null : document.querySelector<HTMLElement>(`[data-ref-id="${target}"]`);
    (link ?? searchBox.current)?.focus();
  }, [library]);

  useEffect(() => {
    if (libraryRef.current) syncTile(libraryRef.current);
  }, [unit, syncTile]);

  useEffect(() => {
    const mine = ++searchSeq.current;
    if (!query.trim() && !family) {
      setResults(null);
      return;
    }
    const timer = window.setTimeout(
      () => {
        const params = new URLSearchParams({ q: query.trim() });
        if (family) params.set("colour_family", family);
        api<SearchResult>("GET", `/search?${params}`).then(
          (answer) => {
            if (mine !== searchSeq.current) return;
            setResults(answer.results);
            say(matchCopy(answer.results.length));
          },
          () => {
            if (mine === searchSeq.current) say(COPY.generic);
          },
        );
      },
      typing.current ? SEARCH_DEBOUNCE_MS : 0,
    );
    return () => window.clearTimeout(timer);
  }, [query, family, say]);

  const loadRow = useCallback(
    (reference: Reference) => {
      if (tileKey.current === reference.id) return;
      tileKey.current = reference.id;
      field.swapTo(subjectOf(reference, unit), 1);
    },
    [field, unit],
  );

  const empty = library !== null && flatten(library).length === 0;

  return (
    <>
      <h1>Library</h1>
      <PullCard pull={pull} />
      <div className="search-bar">
        <div className="field-row">
          <div className="label-line">
            <label htmlFor="search">Search your deck</label>
          </div>
          <input
            ref={searchBox}
            id="search"
            type="search"
            placeholder="Name, maker, material, finish"
            value={query}
            autoComplete="off"
            onChange={(event) => {
              typing.current = true;
              setQuery(event.target.value);
            }}
          />
        </div>
        <ColourSelect
          id="colour-filter"
          value={family}
          allLabel="All colours"
          onChange={(value) => {
            typing.current = false;
            setFamily(value);
          }}
        />
      </div>
      {results !== null ? (
        <RowList references={results} unit={unit} onLoad={loadRow} />
      ) : (
        library &&
        !empty && (
          <>
            <h2>Saved today</h2>
            {library.saved_today.length > 0 ? (
              <RowList references={library.saved_today} unit={unit} onLoad={loadRow} />
            ) : (
              <p className="muted">Nothing saved today.</p>
            )}
            <h2>Earlier</h2>
            <RowList references={library.earlier} unit={unit} onLoad={loadRow} />
          </>
        )
      )}
    </>
  );
}
