import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useConfig, useNow } from '../clock';
import { PersonCard } from '../components/PersonCard';
import { relativeTime } from '../format';
import { useLive } from '../live';
import {
  SEARCH_TYPES,
  countText,
  searchPath,
  typeOf,
  type AnyResponse,
  type JobFilters,
  type PeopleFilters,
  type SearchType,
} from '../search/query';
import type { JobCard, PersonCard as PersonCardData, Post } from '../types';
import { Button, EmptyState, moveRovingFocus } from '../ui';
import '../search/search.css';

const DEBOUNCE_MS = 300;
const TIMEOUT_MS = 10_000;
const DEGREES = [
  { value: '1', label: '1st' },
  { value: '2', label: '2nd' },
  { value: '3', label: '3rd+' },
] as const;
const WORKPLACES = [
  { value: '', label: 'Any' },
  { value: 'on-site', label: 'On-site' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'remote', label: 'Remote' },
] as const;
const POSTED = [
  { value: '', label: 'Any time' },
  { value: 'day', label: 'Past 24 hours' },
  { value: 'week', label: 'Past week' },
  { value: 'month', label: 'Past month' },
] as const;

type Status = 'loading' | 'ready' | 'failed';

export default function Search() {
  const config = useConfig();
  const now = useNow();
  const [params, setParams] = useSearchParams();
  const type = typeOf(params.get('type'));
  const q = params.get('q') ?? '';
  const [people, setPeople] = useState<PeopleFilters>({ degrees: [], company: '', location: '' });
  const [jobs, setJobs] = useState<JobFilters>({ location: '', workplace: '', posted: '' });
  const [response, setResponse] = useState<AnyResponse | null>(null);
  const [extra, setExtra] = useState<AnyResponse['results']>([]);
  const [status, setStatus] = useState<Status>('loading');
  const latest = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  const previousQuery = useRef<string | null>(null);
  const request = searchPath(type, q, people, jobs);

  const run = useCallback(
    async (path: string, append: string | null): Promise<void> => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      const sequence = ++latest.current;
      const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const next = await api.get<AnyResponse>(append ? `${path}&cursor=${encodeURIComponent(append)}` : path, { signal: controller.signal });
        if (sequence !== latest.current) return;
        if (append) {
          setExtra((current) => [...current, ...next.results] as AnyResponse['results']);
          setResponse((current) => (current ? ({ ...current, next_cursor: next.next_cursor } as AnyResponse) : next));
        } else {
          setExtra([]);
          setResponse(next);
        }
        setStatus('ready');
      } catch {
        if (sequence === latest.current) setStatus('failed');
      } finally {
        window.clearTimeout(timer);
      }
    },
    [],
  );

  // The text waits for a pause; a tab or filter change goes out at once. Either way only the latest request counts.
  useEffect(() => {
    const queryChanged = previousQuery.current !== null && previousQuery.current !== `${type}|${q}`;
    const textOnly = queryChanged && previousQuery.current?.startsWith(`${type}|`);
    previousQuery.current = `${type}|${q}`;
    if (!textOnly) {
      void run(request, null);
      return undefined;
    }
    const timer = window.setTimeout(() => void run(request, null), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [request, run, type, q]);

  useLive(['graph', 'network', 'job', 'clock', 'reconnected'], () => void run(request, null));

  const results = response ? [...response.results, ...extra] : [];
  const total = response?.total ?? 0;
  const failed = status === 'failed';
  const statusText = failed || !response ? '' : countText(total, q);
  const noResults = !failed && response !== null && total === 0 && q.trim() !== '';

  const setType = (next: SearchType): void => {
    const nextParams = new URLSearchParams(params);
    nextParams.set('type', next);
    setParams(nextParams);
  };

  const tabs = useRef<HTMLDivElement>(null);
  const onTabKey = (event: React.KeyboardEvent): void => {
    const items = [...(tabs.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
    if (moveRovingFocus(event, items, { orientation: 'horizontal', wrap: true, homeEnd: true })) {
      const index = items.indexOf(document.activeElement as HTMLElement);
      const target = SEARCH_TYPES[index];
      if (target) setType(target.type);
    }
  };

  return (
    <div className="search">
      <h1 className="page-title">Search</h1>
      <div ref={tabs} role="tablist" aria-label="Result type" className="search-tabs" onKeyDown={onTabKey}>
        {SEARCH_TYPES.map((tab) => (
          <button
            key={tab.type}
            role="tab"
            type="button"
            id={`search-tab-${tab.type}`}
            aria-selected={type === tab.type}
            aria-controls="search-results"
            tabIndex={type === tab.type ? 0 : -1}
            className="search-tab"
            onClick={() => setType(tab.type)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {type === 'people' ? (
        <div className="search-filters">
          <fieldset role="group" aria-label="Degree" className="degree-group">
            <legend className="field-label degree-legend">Degree</legend>
            {DEGREES.map((degree) => (
              <label key={degree.value} className="check">
                <input
                  type="checkbox"
                  checked={people.degrees.includes(degree.value)}
                  onChange={(event) =>
                    setPeople({
                      ...people,
                      degrees: event.target.checked ? [...people.degrees, degree.value] : people.degrees.filter((d) => d !== degree.value),
                    })
                  }
                />
                {degree.label}
              </label>
            ))}
          </fieldset>
          <label className="search-field">
            <span className="field-label">Current company</span>
            <input className="input" type="text" value={people.company} onChange={(event) => setPeople({ ...people, company: event.target.value })} />
          </label>
          <label className="search-field">
            <span className="field-label">Location</span>
            <input className="input" type="text" value={people.location} onChange={(event) => setPeople({ ...people, location: event.target.value })} />
          </label>
        </div>
      ) : null}

      {type === 'jobs' ? (
        <div className="search-filters">
          <label className="search-field">
            <span className="field-label">Location</span>
            <input className="input" type="text" value={jobs.location} onChange={(event) => setJobs({ ...jobs, location: event.target.value })} />
          </label>
          <label className="search-field">
            <span className="field-label">Workplace</span>
            <select className="input" value={jobs.workplace} onChange={(event) => setJobs({ ...jobs, workplace: event.target.value as JobFilters['workplace'] })}>
              {WORKPLACES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="search-field">
            <span className="field-label">Date posted</span>
            <select className="input" value={jobs.posted} onChange={(event) => setJobs({ ...jobs, posted: event.target.value as JobFilters['posted'] })}>
              {POSTED.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      <div id="search-results" role="tabpanel" aria-labelledby={`search-tab-${type}`} className="search-panel">
        <p role="status" aria-label="Search results" className={noResults ? 'empty-sentence' : 'search-count t-larger'}>
          {statusText}
        </p>
        {noResults ? (
          <Link to={`/search?type=${type}&q=`} className="empty-action">
            Clear search
          </Link>
        ) : null}
        {failed ? (
          <EmptyState sentence="Search isn't working right now." action={{ label: 'Try again', onClick: () => void run(request, null) }} />
        ) : null}

        {!failed && type === 'people' ? (
          <ul className="plain-list search-list">
            {(results as PersonCardData[]).map((card) => (
              <PersonCard key={card.id} card={card} />
            ))}
          </ul>
        ) : null}
        {!failed && type === 'posts' ? (
          <ul className="plain-list search-list">
            {(results as Post[]).map((post) => (
              <li key={post.id} className="surface post-hit">
                <p className="post-hit-author">
                  <Link to={`/in/${post.author.handle}`}>{post.author.name}</Link>
                  <span className="muted"> · {relativeTime(post.created_at, now, config.time_zone)}</span>
                </p>
                <p className="post-hit-text">
                  <Link to={`/posts/${post.id}`}>{post.text}</Link>
                </p>
              </li>
            ))}
          </ul>
        ) : null}
        {!failed && type === 'jobs' ? (
          <ul className="plain-list search-list">
            {(results as JobCard[]).map((job) => (
              <li key={job.id} className="surface job-hit" data-job-id={job.id}>
                <p className="job-hit-title">
                  <Link to={`/jobs/${job.id}`}>{job.title}</Link>
                </p>
                <p>
                  <Link to={`/company/${job.company.handle}`}>{job.company.name}</Link>
                </p>
                <p className="muted">
                  {job.location} · {job.workplace === 'on-site' ? 'On-site' : job.workplace === 'hybrid' ? 'Hybrid' : 'Remote'} ·{' '}
                  {relativeTime(job.posted_at, now, config.time_zone)}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
        {!failed && response?.next_cursor ? (
          <div className="search-more">
            <Button onClick={() => void run(request, response.next_cursor)}>Show more results</Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
