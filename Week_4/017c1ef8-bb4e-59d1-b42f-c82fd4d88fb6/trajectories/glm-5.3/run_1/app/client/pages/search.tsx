import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../app-context.js';
import type { JobCard, PersonCard, Post } from '../types.js';
import { degreeLabel, searchCountText } from '../format.js';
import { Entry } from '../components/post.js';

type SearchType = 'people' | 'posts' | 'jobs';
type PeopleResult = { total: number; results: PersonCard[] };
type PostsResult = { total: number; results: Post[] };
type JobsResult = { total: number; results: JobCard[] };

export const SearchPage = (): JSX.Element => {
  const { route, navigate, liveEvents } = useApp();
  const [type, setType] = useState<SearchType>((route.params.type as SearchType) ?? 'people');
  const [query, setQuery] = useState(route.params.q ?? '');
  const [people, setPeople] = useState<PersonCard[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [jobs, setJobs] = useState<JobCard[]>([]);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState(false);
  const [degreeFilters, setDegreeFilters] = useState<Set<string>>(new Set());
  const [company, setCompany] = useState('');
  const [location, setLocation] = useState('');
  const [workplace, setWorkplace] = useState('');
  const [posted, setPosted] = useState('');
  const timer = useRef<number | null>(null);
  const latestQuery = useRef('');

  const runSearch = useCallback(async (searchType: SearchType, q: string): Promise<void> => {
    latestQuery.current = `${searchType}|${q}`;
    try {
      const params = new URLSearchParams({ type: searchType, q });
      if (searchType === 'people') {
        if (degreeFilters.size > 0 && degreeFilters.size < 3) params.set('degree', [...degreeFilters].join(','));
        if (company) params.set('company', company);
        if (location) params.set('location', location);
        const result = await api.get<PeopleResult>(`/api/search?${params.toString()}`);
        if (latestQuery.current !== `${searchType}|${q}`) return;
        setPeople(result.results);
        setTotal(result.total);
      } else if (searchType === 'posts') {
        const result = await api.get<PostsResult>(`/api/search?${params.toString()}`);
        if (latestQuery.current !== `${searchType}|${q}`) return;
        setPosts(result.results);
        setTotal(result.total);
      } else {
        if (location) params.set('location', location);
        if (workplace) params.set('workplace', workplace);
        if (posted) params.set('posted', posted);
        const result = await api.get<JobsResult>(`/api/search?${params.toString()}`);
        if (latestQuery.current !== `${searchType}|${q}`) return;
        setJobs(result.results);
        setTotal(result.total);
      }
      setFailed(false);
    } catch {
      if (latestQuery.current !== `${searchType}|${q}`) return;
      setFailed(true);
    }
  }, [degreeFilters, company, location, workplace, posted]);

  useEffect(() => {
    const q = query;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void runSearch(type, q); }, 300);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [query, type, runSearch]);

  useEffect(() => {
    window.history.replaceState({}, '', `/search?type=${type}&q=${encodeURIComponent(query)}`);
  }, [type, query]);

  useEffect(() => {
    return liveEvents.subscribe((event) => {
      if (event === 'connection' || event === 'blocked' || event === 'post_update' || event === 'clock') void runSearch(type, query);
    });
  }, [liveEvents, runSearch, type, query]);

  const countText = searchCountText(total, query);

  return (
    <>
      <h1 className="profile-name">Search</h1>
      <div role="tablist" aria-label="Result type">
        {(['people', 'posts', 'jobs'] as SearchType[]).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={type === tab}
            className="text-button"
            onClick={() => setType(tab)}
          >
            {tab === 'people' ? 'People' : tab === 'posts' ? 'Posts' : 'Jobs'}
          </button>
        ))}
      </div>
      <input
        type="search"
        className="field"
        aria-label="Search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {type === 'people' && (
        <fieldset className="search-filters">
          <legend className="visually-hidden">People filters</legend>
          <div role="group" aria-label="Degree">
            {(['1', '2', '3'] as const).map((degree) => (
              <label key={degree}>
                <input
                  type="checkbox"
                  checked={degreeFilters.has(degree)}
                  onChange={(e) => setDegreeFilters((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(degree); else next.delete(degree);
                    return next;
                  })}
                />
                {degree === '3' ? '3rd+' : `${degree}st`}
              </label>
            ))}
          </div>
          <label>
            Current company
            <input className="field" value={company} onChange={(e) => setCompany(e.target.value)} />
          </label>
          <label>
            Location
            <input className="field" value={location} onChange={(e) => setLocation(e.target.value)} />
          </label>
        </fieldset>
      )}
      {type === 'jobs' && (
        <fieldset className="search-filters">
          <legend className="visually-hidden">Job filters</legend>
          <label>
            Location
            <input className="field" value={location} onChange={(e) => setLocation(e.target.value)} />
          </label>
          <label>
            Workplace
            <select className="field" value={workplace} onChange={(e) => setWorkplace(e.target.value)} aria-label="Workplace">
              <option value="">Any</option>
              <option value="on-site">On-site</option>
              <option value="hybrid">Hybrid</option>
              <option value="remote">Remote</option>
            </select>
          </label>
          <label>
            Date posted
            <select className="field" value={posted} onChange={(e) => setPosted(e.target.value)} aria-label="Date posted">
              <option value="">Any time</option>
              <option value="day">Past 24 hours</option>
              <option value="week">Past week</option>
              <option value="month">Past month</option>
            </select>
          </label>
        </fieldset>
      )}
      <p role="status" aria-live="polite" aria-label="Search results">{countText}</p>
      {failed && (
        <div className="big-empty">
          <p>Search isn't working right now.</p>
          <button type="button" className="text-button" onClick={() => { void runSearch(type, query); }}>Try again</button>
        </div>
      )}
      {total === 0 && !failed && query.trim().length > 0 && (
        <div className="big-empty">
          <p>{countText}</p>
          <button type="button" className="text-button" onClick={() => setQuery('')}>Clear search</button>
        </div>
      )}
      {type === 'people' && people.map((member) => (
        <PersonCardView key={member.id} member={member} />
      ))}
      {type === 'posts' && posts.map((post) => (
        <Entry
          key={post.id}
          entry={{ entry_id: post.id, kind: 'post', created_at: post.created_at, post, reposter: null }}
          focused={false}
          onFocus={() => undefined}
          onChanged={() => { void runSearch('posts', query); }}
        />
      ))}
      {type === 'jobs' && jobs.map((job) => (
        <li key={job.id} className="job-card" data-job-id={job.id}>
          <h3><a href={`/jobs/${job.id}`} onClick={(e) => { e.preventDefault(); navigate(`/jobs/${job.id}`); }}>{job.title}</a></h3>
          <p>{job.company.name}</p>
          <p>{job.location} · {job.workplace}</p>
          <p className="entry-time">{job.posted_at}</p>
        </li>
      ))}
    </>
  );
};

const PersonCardView = ({ member }: { member: PersonCard }): JSX.Element => {
  const { navigate } = useApp();
  const [busy, setBusy] = useState(false);

  const connect = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.post('/api/connections', { member_id: member.id });
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="person-card" data-member-id={member.id} data-degree={member.degree} data-connection-state={member.connection_state}>
      <a href={`/in/${member.handle}`} onClick={(e) => { e.preventDefault(); navigate(`/in/${member.handle}`); }}>{member.name}</a>
      <p className="entry-headline">{member.headline}</p>
      <span className="degree-label-badge" data-degree-badge data-degree={member.degree}>{degreeLabel(member.degree)}</span>
      <div className="entry-actions">
        {(member.connection_state === 'none' || member.connection_state === 'withdrawn' || member.connection_state === 'ignored') && (
          <button type="button" className="pink-button" onClick={() => { void connect(); }} disabled={busy}>
            Connect with {member.name}
          </button>
        )}
        {member.connection_state === 'pending_sent' && (
          <button type="button" className="text-button" disabled>Withdraw request to {member.name}</button>
        )}
        {member.connection_state === 'pending_received' && (
          <>
            <button type="button" className="pink-button" disabled>Accept {member.name}</button>
            <button type="button" className="text-button" disabled>Ignore {member.name}</button>
          </>
        )}
        {member.connection_state === 'connected' && (
          <button type="button" className="text-button" onClick={() => navigate(`/messaging/with/${member.handle}`)}>
            Message {member.name}
          </button>
        )}
      </div>
    </li>
  );
};
