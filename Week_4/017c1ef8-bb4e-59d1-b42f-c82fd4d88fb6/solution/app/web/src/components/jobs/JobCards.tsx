import { Link } from 'react-router-dom';
import { useConfig, useNow } from '../../clock';
import { relativeTime } from '../../format';
import type { JobCard } from '../../types';
import { WORKPLACE_LABELS } from './jobModel';
import './jobs.css';

/** Job cards as a list: title as a link, company, location, workplace and posted time. */
export function JobCards({ jobs, label }: { jobs: JobCard[]; label: string }) {
  const { time_zone: zone } = useConfig();
  const now = useNow();
  return (
    <ul className="job-cards plain-list" aria-label={label}>
      {jobs.map((job) => (
        <li key={job.id} className="job-card surface" data-job-id={job.id}>
          <h2 className="job-card-title">
            <Link to={`/jobs/${job.id}`}>{job.title}</Link>
          </h2>
          <p className="t-larger">
            <Link to={`/company/${job.company.handle}`}>{job.company.name}</Link>
          </p>
          <p className="muted">
            {job.location} · {WORKPLACE_LABELS[job.workplace]} · <time dateTime={job.posted_at}>{relativeTime(job.posted_at, now, zone)}</time>
          </p>
        </li>
      ))}
    </ul>
  );
}
