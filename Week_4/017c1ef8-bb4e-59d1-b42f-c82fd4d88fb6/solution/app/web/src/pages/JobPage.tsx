import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { announce } from '../announce';
import { api } from '../api';
import { useConfig } from '../clock';
import { ApplyDialog } from '../components/jobs/ApplyDialog';
import { MOVED_BY_TEXT, SOMETHING_WENT_WRONG, WORKPLACE_LABELS, type JobObject } from '../components/jobs/jobModel';
import { formatDate, formatTime } from '../format';
import { useLive } from '../live';
import { Alert, Button, EmptyState } from '../ui';
import '../components/jobs/jobs.css';

/** One job: its facts, the published hiring stages, Save, and Apply until the closing instant. */
export default function JobPage() {
  const { jobId = '' } = useParams();
  const { time_zone: zone } = useConfig();
  const [job, setJob] = useState<JobObject | null>(null);
  const [missing, setMissing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [alert, setAlert] = useState('');

  const load = (): void => {
    api
      .get<JobObject>(`/api/jobs/${jobId}`)
      .then(setJob)
      .catch(() => setMissing(true));
  };

  useEffect(load, [jobId]);
  useLive(['job', 'clock', 'application', 'reconnected'], (event) => {
    if (event.type === 'job' && event.job_id !== jobId) return;
    load();
  });

  if (missing) return <EmptyState heading="h1" sentence="We couldn't find that page." action={{ label: 'Go to Home', to: '/feed' }} />;
  if (!job) return null;

  const { open } = job;

  const toggleSaved = async (): Promise<void> => {
    setAlert('');
    try {
      if (job.saved) await api.delete(`/api/jobs/${job.id}/save`);
      else await api.put(`/api/jobs/${job.id}/save`);
      setJob({ ...job, saved: !job.saved });
      announce('Jobs announcements', job.saved ? 'Job removed from saved.' : 'Job saved.');
    } catch {
      setAlert(SOMETHING_WENT_WRONG);
    }
  };

  return (
    <article className="stack job-page">
      <header className="stack-s">
        <h1 className="page-title">{job.title}</h1>
        <p className="t-larger">
          <Link to={`/company/${job.company.handle}`}>{job.company.name}</Link>
        </p>
        <p className="muted">
          {job.location} · {WORKPLACE_LABELS[job.workplace]}
        </p>
        <p className="muted">
          Closes {formatDate(job.closes_at, zone)} at {formatTime(job.closes_at, zone)}
        </p>
      </header>
      <div className="job-actions row">
        {open && !job.my_application ? <Button onClick={() => setApplying(true)}>Apply</Button> : null}
        {!open ? <p className="t-larger">No longer accepting applications</p> : null}
        {job.my_application ? (
          <p className="t-larger">
            {job.my_application.status_text} · <Link to="/my-jobs">My jobs</Link>
          </p>
        ) : null}
        <Button aria-pressed={job.saved} onClick={() => void toggleSaved()}>
          {job.saved ? 'Saved' : 'Save job'}
        </Button>
        {job.is_poster ? <Link to={`/jobs/${job.id}/applicants`}>Applicants</Link> : null}
        {job.is_admin ? <Link to={`/jobs/${job.id}/edit`}>Edit job</Link> : null}
      </div>
      <Alert>{alert}</Alert>
      <section className="stack-s" aria-labelledby="job-description">
        <h2 id="job-description" className="t-larger">
          About the job
        </h2>
        <p className="job-description">{job.description}</p>
      </section>
      <section className="stack-s" aria-labelledby="job-stages">
        <h2 id="job-stages" className="t-larger">
          Hiring stages
        </h2>
        <ul className="plain-list stages" aria-label="Hiring stages">
          {job.stages.map((stage) => (
            <li key={stage.state}>{`${stage.label} · ${stage.status_text} · Moved by ${MOVED_BY_TEXT[stage.moved_by]}`}</li>
          ))}
        </ul>
      </section>
      <ApplyDialog
        job={job}
        open={applying}
        onClose={() => setApplying(false)}
        onApplied={() => {
          setApplying(false);
          load();
        }}
      />
    </article>
  );
}
