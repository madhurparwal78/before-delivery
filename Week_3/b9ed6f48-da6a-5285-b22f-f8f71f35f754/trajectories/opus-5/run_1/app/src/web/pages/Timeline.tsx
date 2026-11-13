import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { Link, useRouter } from '../lib/router.js';
import { BookmarkButton } from '../components/BookmarkButton.js';
import { copy, searchEmpty, searchStatus } from '../../shared/copy.js';
import { numeralFor } from '../../shared/sightline.js';
import type { ChapterSummary, SearchResult, SourceRecord, TimelineEvent } from '../../shared/types.js';

const DEBOUNCE_MS = 400;
const MINIMUM_QUERY = 2;

function addressFor(query: string, chapter: string): string {
  const parameters = new URLSearchParams();
  if (query.trim().length >= MINIMUM_QUERY) parameters.set('q', query);
  if (chapter !== '') parameters.set('chapter', chapter);
  const search = parameters.toString();
  return search === '' ? '/timeline' : `/timeline?${search}`;
}

export function Timeline({
  chapters,
  sources,
}: {
  chapters: ChapterSummary[];
  sources: SourceRecord[];
}): JSX.Element {
  const { search, navigate } = useRouter();
  const [query, setQuery] = useState(() => search.get('q') ?? '');
  const [chapter, setChapter] = useState(() => search.get('chapter') ?? '');
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    navigate(addressFor(query, chapter), { replace: true });
    const trimmed = query.trim();
    const sequence = latest.current + 1;
    latest.current = sequence;
    const chapterQuery = chapter === '' ? '' : `chapter=${chapter}`;

    const fetchTimeline = (): void => {
      void api<{ events: TimelineEvent[] }>(`/api/timeline${chapterQuery ? `?${chapterQuery}` : ''}`)
        .then((result) => {
          if (latest.current !== sequence) return;
          setEvents(result.events);
          setResults(null);
        })
        .catch(() => undefined);
    };

    if (trimmed.length < MINIMUM_QUERY) {
      fetchTimeline();
      return undefined;
    }

    const timer = window.setTimeout(() => {
      const parameters = new URLSearchParams({ q: trimmed });
      if (chapter !== '') parameters.set('chapter', chapter);
      void api<{ results: SearchResult[] }>(`/api/search?${parameters.toString()}`)
        .then((result) => {
          if (latest.current !== sequence) return;
          setResults(result.results);
        })
        .catch(() => undefined);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    /* The address is written from the same state this effect reads. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, chapter]);

  const trimmed = query.trim();
  const searching = trimmed.length >= MINIMUM_QUERY;
  const shown = searching ? (results ?? []) : (events ?? []);

  return (
    <>
      <h1>The timeline archive</h1>
      <div className="columns">
        <div className="field">
          <label htmlFor="timeline-search">Search the archive</label>
          <input
            id="timeline-search"
            type="search"
            aria-label="Search the archive"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="timeline-chapter">Chapter</label>
          <select
            id="timeline-chapter"
            aria-label="Chapter"
            value={chapter}
            onChange={(event) => setChapter(event.target.value)}
          >
            <option value="">All chapters</option>
            {chapters.map((entry) => (
              <option key={entry.number} value={String(entry.number)}>
                {`Chapter ${entry.numeral}`}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p role="status" aria-label="Search status" className="readout">
        {searching ? searchStatus(shown.length, trimmed) : ''}
      </p>

      <section aria-label="Search results">
        {shown.length === 0 ? (
          <p className="secondary">{searching ? searchEmpty(trimmed) : copy.emptyChapterEvents}</p>
        ) : searching ? (
          <ul className="card-grid">
            {(shown as SearchResult[]).map((result) => (
              <li key={`${result.type}-${result.id}`} className="museum-card">
                <span className="catalogue">{result.type === 'chapter' ? 'Chapter' : 'Timeline event'}</span>
                <h2 style={{ fontSize: 'var(--step-2)' }}>
                  <Link to={`/chapters/${result.chapter}`}>{result.title}</Link>
                </h2>
                <span className="secondary">{`Chapter ${numeralFor(result.chapter)}`}</span>
                {result.type === 'event' ? (
                  <BookmarkButton
                    targetType="event"
                    targetId={result.id}
                    title={result.title}
                    label={`Bookmark ${result.title}`}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <ul className="card-grid">
            {(shown as TimelineEvent[]).map((event) => (
              <li key={event.id} className="museum-card">
                <span className="catalogue figure">{event.year}</span>
                <h2 style={{ fontSize: 'var(--step-2)' }}>{event.title}</h2>
                <p>{event.summary}</p>
                <span className="secondary">
                  <Link to={`/chapters/${event.chapter}`}>{`Chapter ${numeralFor(event.chapter)}`}</Link>
                </span>
                <ul>
                  {event.source_ids.map((id) => (
                    <li key={id} className="secondary">
                      {sources.find((source) => source.id === id)?.citation ?? id}
                    </li>
                  ))}
                </ul>
                <BookmarkButton
                  targetType="event"
                  targetId={event.id}
                  title={event.title}
                  label={`Bookmark ${event.title}`}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
