// The timeline archive (brief: Screens and layout › Timeline archive; Interactions › Search and
// filter). The search text and chapter filter live in the page address; only the answer for the
// text and filter as they are now is ever shown.

import { useEffect, useMemo, useRef, useState } from "react";
import { api, type SearchResult, type Source, type TimelineEvent } from "../api.js";
import { useApi, useBookmarks, useChapters } from "../hooks.js";
import { replaceAddress } from "../router.js";
import { useApp } from "../state.js";
import { EmptyMark, Icon, Skeleton } from "../components/ui.js";
import { ChapterCard } from "./Index.js";
import { COPY, NUMERALS, copyFor } from "../../shared/copy.js";

const DEBOUNCE_MS = 300;
const MIN_QUERY = 2;

export function useCitations(): Map<string, string> {
  const { data } = useApi<{ sources: Source[] }>("/api/sources");
  return useMemo(() => new Map((data?.sources ?? []).map((s) => [s.id, s.citation])), [data]);
}

interface EventCardProps {
  event: TimelineEvent;
  numeral: string;
  citations: Map<string, string>;
  bookmarks: ReturnType<typeof useBookmarks>;
}

export function EventCard({ event, numeral, citations, bookmarks }: EventCardProps) {
  const pressed = bookmarks.marked(event.id);
  return (
    <article className="event-card museum-card">
      <div className="card-head">
        <span className="catalogue">
          HRR-{numeral} · {event.year}
        </span>
        <button
          type="button"
          className="icon-button"
          aria-label={`Bookmark ${event.title}`}
          aria-pressed={pressed}
          onClick={(e) => void bookmarks.toggle("event", event.id, event.title, e.currentTarget)}
        >
          <Icon name="bookmark" filled={pressed} />
        </button>
      </div>
      <p className="event-year">{event.year}</p>
      <h3 className="card-title">{event.title}</h3>
      <p className="card-text">{event.summary}</p>
      <p className="era">Chapter {numeral}</p>
      {event.source_ids.length > 0 && (
        <ul className="event-sources" aria-label="Sources">
          {event.source_ids.map((id) => (
            <li key={id}>{citations.get(id) ?? id}</li>
          ))}
        </ul>
      )}
    </article>
  );
}

function readAddress(): { q: string; chapter: number | null } {
  const params = new URLSearchParams(location.search);
  const chapter = Number(params.get("chapter"));
  return { q: params.get("q") ?? "", chapter: Number.isInteger(chapter) && chapter >= 1 && chapter <= NUMERALS.length ? chapter : null };
}

function addressFor(q: string, chapter: number | null): string {
  const params = new URLSearchParams();
  if (q.length >= MIN_QUERY) params.set("q", q);
  if (chapter !== null) params.set("chapter", String(chapter));
  const search = params.toString();
  return search ? `/timeline?${search}` : "/timeline";
}

export function TimelinePage() {
  const app = useApp();
  const initial = useMemo(readAddress, []);
  const [text, setText] = useState(initial.q);
  const [query, setQuery] = useState(initial.q);
  const [chapter, setChapter] = useState<number | null>(initial.chapter);
  const [answer, setAnswer] = useState<{ q: string; chapter: number | null; results: SearchResult[] } | null>(null);
  const latest = useRef(0);
  const chapters = useChapters(app.user?.id ?? null, app.pathVersion);
  const timeline = useApi<{ events: TimelineEvent[] }>("/api/timeline");
  const citations = useCitations();
  const bookmarks = useBookmarks();
  const searching = query.length >= MIN_QUERY;

  useEffect(() => {
    if (text === query) return;
    const timer = window.setTimeout(() => setQuery(text), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [text, query]);

  useEffect(() => {
    replaceAddress(addressFor(query, chapter));
  }, [query, chapter]);

  useEffect(() => {
    const ticket = ++latest.current;
    if (!searching) return;
    const params = new URLSearchParams({ q: query });
    if (chapter !== null) params.set("chapter", String(chapter));
    api<{ results: SearchResult[] }>(`/api/search?${params}`).then(
      ({ results }) => ticket === latest.current && setAnswer({ q: query, chapter, results }),
      () => undefined,
    );
  }, [query, chapter, searching]);

  const options = chapters ?? (chapter !== null ? [{ number: chapter, numeral: NUMERALS[chapter - 1] }] : []);
  const numeralOf = (n: number) => NUMERALS[n - 1];
  const events = timeline.data?.events ?? null;
  const shown = searching && text === query && answer?.q === query && answer.chapter === chapter ? answer.results : null;
  const filtered = events?.filter((e) => chapter === null || e.chapter === chapter) ?? null;

  const results = () => {
    if (searching) {
      if (!shown || !events) return <Skeleton lines={4} />;
      if (!shown.length)
        return (
          <div className="empty-state museum-card">
            <EmptyMark />
            <p>{copyFor.nothingMatches(query)}</p>
          </div>
        );
      return (
        <ol className="card-grid result-grid">
          {shown.map((r) => {
            const summary = r.type === "chapter" ? chapters?.find((c) => c.number === r.chapter) : null;
            const event = r.type === "event" ? events.find((e) => e.id === r.id) : null;
            return (
              <li key={r.id}>
                {summary ? (
                  <ChapterCard chapter={summary} />
                ) : event ? (
                  <EventCard event={event} numeral={numeralOf(event.chapter)} citations={citations} bookmarks={bookmarks} />
                ) : (
                  <article className="event-card museum-card">
                    <p className="catalogue">HRR-{numeralOf(r.chapter)}</p>
                    <h3 className="card-title">{r.title}</h3>
                  </article>
                )}
              </li>
            );
          })}
        </ol>
      );
    }
    if (!filtered) return <Skeleton lines={4} />;
    if (!filtered.length)
      return (
        <div className="empty-state museum-card">
          <EmptyMark />
          <p>{COPY.emptyEvents}</p>
          <button type="button" className="button button-quiet" onClick={() => setChapter(null)}>
            Show all chapters
          </button>
        </div>
      );
    return (
      <ol className="card-grid event-grid">
        {filtered.map((e) => (
          <li key={e.id}>
            <EventCard event={e} numeral={numeralOf(e.chapter)} citations={citations} bookmarks={bookmarks} />
          </li>
        ))}
      </ol>
    );
  };

  return (
    <div className="page timeline-page">
      <header className="page-intro">
        <p className="eyebrow">The archive</p>
        <h1>Timeline</h1>
        <p className="lede">Two centuries of machines that count, reason and learn, in the order they happened. Search titles, summaries and eras, or keep to one room.</p>
      </header>
      <div className="search-bar" role="search">
        <div className="field search-field">
          <label htmlFor="archive-search">Search the archive</label>
          <span className="search-input">
            <Icon name="lens" />
            <input id="archive-search" type="search" autoComplete="off" value={text} onChange={(e) => setText(e.currentTarget.value)} />
          </span>
        </div>
        <div className="field select-field">
          <label htmlFor="archive-chapter">Chapter</label>
          <select id="archive-chapter" value={chapter ?? ""} onChange={(e) => setChapter(e.currentTarget.value ? Number(e.currentTarget.value) : null)}>
            <option value="">All chapters</option>
            {options.map((c) => (
              <option key={c.number} value={c.number}>
                Chapter {c.numeral}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div role="status" aria-label="Search status" className="search-status">
        {shown ? copyFor.searchCount(shown.length, query) : ""}
      </div>
      <section aria-label="Search results" className="search-results" aria-busy={searching && !shown}>
        {results()}
      </section>
    </div>
  );
}
