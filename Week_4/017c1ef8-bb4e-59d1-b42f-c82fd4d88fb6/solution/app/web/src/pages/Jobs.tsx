import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { JobCards } from '../components/jobs/JobCards';
import { SOMETHING_WENT_WRONG, WORKPLACES, WORKPLACE_LABELS, type PageResults, type Workplace } from '../components/jobs/jobModel';
import { useLive } from '../live';
import type { JobCard } from '../types';
import { Alert, Button, EmptyState } from '../ui';

const POSTED = [
  { value: '', label: 'Any time' },
  { value: 'day', label: 'Past 24 hours' },
  { value: 'week', label: 'Past week' },
  { value: 'month', label: 'Past month' },
] as const;

type Posted = (typeof POSTED)[number]['value'];

function searchPath(location: string, workplace: Workplace | '', posted: Posted, cursor: string | null): string {
  const params = new URLSearchParams({ type: 'jobs', q: '' });
  if (location.trim()) params.set('location', location.trim());
  if (workplace) params.set('workplace', workplace);
  if (posted) params.set('posted', posted);
  if (cursor) params.set('cursor', cursor);
  return `/api/search?${params.toString()}`;
}

/** Open jobs, filtered by location, workplace and date posted; the results change in place. */
export default function Jobs() {
  const [location, setLocation] = useState('');
  const [workplace, setWorkplace] = useState<Workplace | ''>('');
  const [posted, setPosted] = useState<Posted>('');
  const [jobs, setJobs] = useState<JobCard[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);

  const load = (): void => {
    const request = ++latest.current;
    api
      .get<PageResults<JobCard>>(searchPath(location, workplace, posted, null))
      .then((page) => {
        if (request !== latest.current) return;
        setJobs(page.results);
        setCursor(page.next_cursor);
        setFailed(false);
      })
      .catch(() => request === latest.current && setFailed(true));
  };

  useEffect(load, [location, workplace, posted]);
  useLive(['job', 'clock', 'reconnected'], load);

  const more = (): void => {
    if (!cursor) return;
    api
      .get<PageResults<JobCard>>(searchPath(location, workplace, posted, cursor))
      .then((page) => {
        setJobs((current) => [...(current ?? []), ...page.results]);
        setCursor(page.next_cursor);
      })
      .catch(() => setFailed(true));
  };

  return (
    <div className="stack jobs-page">
      <h1 className="page-title">Jobs</h1>
      <div className="job-filters surface">
        <div className="field">
          <label htmlFor="jobs-location" className="field-label">
            Location
          </label>
          <input id="jobs-location" className="input" value={location} onChange={(event) => setLocation(event.target.value)} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="jobs-workplace" className="field-label">
            Workplace
          </label>
          <select id="jobs-workplace" className="input" value={workplace} onChange={(event) => setWorkplace(event.target.value as Workplace | '')}>
            <option value="">Any</option>
            {WORKPLACES.map((value) => (
              <option key={value} value={value}>
                {WORKPLACE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="jobs-posted" className="field-label">
            Date posted
          </label>
          <select id="jobs-posted" className="input" value={posted} onChange={(event) => setPosted(event.target.value as Posted)}>
            {POSTED.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <Alert>{failed ? SOMETHING_WENT_WRONG : null}</Alert>
      {jobs && jobs.length > 0 ? <JobCards jobs={jobs} label="Open jobs" /> : null}
      {jobs && jobs.length === 0 ? <EmptyState sentence="No open jobs match." action={{ label: 'My jobs', to: '/my-jobs' }} /> : null}
      {cursor ? <Button onClick={more}>Show more jobs</Button> : null}
    </div>
  );
}
