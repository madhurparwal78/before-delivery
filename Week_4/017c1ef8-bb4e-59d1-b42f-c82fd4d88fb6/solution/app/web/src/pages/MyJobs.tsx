import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { announce } from '../announce';
import { api } from '../api';
import { HistoryList } from '../components/jobs/HistoryList';
import { JobCards } from '../components/jobs/JobCards';
import { SOMETHING_WENT_WRONG, type MyJobCard } from '../components/jobs/jobModel';
import { useLive } from '../live';
import type { ApplicationState } from '../types';
import { Alert, Button, Dialog, EmptyState, useRovingFocus } from '../ui';
import '../components/jobs/jobs.css';

type Tab = 'saved' | 'applied';

interface WithdrawTarget {
  applicationId: string;
  title: string;
}

/** Saved and Applied jobs. Each application shows its published status and attributed history, live. */
export default function MyJobs() {
  const [tab, setTab] = useState<Tab>('saved');
  const [saved, setSaved] = useState<MyJobCard[] | null>(null);
  const [applied, setApplied] = useState<MyJobCard[] | null>(null);
  const [withdrawing, setWithdrawing] = useState<WithdrawTarget | null>(null);
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState('');
  const tabs = useRovingFocus<HTMLDivElement>('[role="tab"]', { orientation: 'horizontal', wrap: true, homeEnd: true });
  const known = useRef(new Map<string, ApplicationState>());
  const firstLoad = useRef(true);

  const load = (): void => {
    api.get<{ jobs: MyJobCard[] }>('/api/me/jobs?tab=saved').then((body) => setSaved(body.jobs), () => setAlert(SOMETHING_WENT_WRONG));
    api.get<{ jobs: MyJobCard[] }>('/api/me/jobs?tab=applied').then(
      (body) => {
        for (const job of body.jobs) {
          const mine = job.my_application;
          if (!mine) continue;
          const before = known.current.get(mine.id);
          if (!firstLoad.current && before !== undefined && before !== mine.state) {
            announce('Jobs announcements', `Your application for ${job.title} is now: ${mine.status_text}.`);
          }
          known.current.set(mine.id, mine.state);
        }
        firstLoad.current = false;
        setApplied(body.jobs);
      },
      () => setAlert(SOMETHING_WENT_WRONG),
    );
  };

  useEffect(load, []);
  useLive(['application', 'job', 'clock', 'reconnected'], load);

  const withdraw = async (): Promise<void> => {
    if (!withdrawing || pending) return;
    setPending(true);
    try {
      await api.post(`/api/applications/${withdrawing.applicationId}/transition`, { to: 'withdrawn' });
      setWithdrawing(null);
      load();
    } catch {
      setAlert(SOMETHING_WENT_WRONG);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="stack">
      <h1 className="page-title">My jobs</h1>
      <div role="tablist" aria-label="My jobs" className="jobs-tabs step-1" ref={tabs.ref} onKeyDown={tabs.onKeyDown}>
        {(['saved', 'applied'] as const).map((value) => (
          <button key={value} type="button" role="tab" id={`tab-${value}`} className="jobs-tab" aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} onFocus={() => setTab(value)} aria-controls="my-jobs-panel" onClick={() => setTab(value)}>
            {value === 'saved' ? 'Saved' : 'Applied'}
          </button>
        ))}
      </div>
      <Alert>{alert}</Alert>
      <div role="tabpanel" id="my-jobs-panel" aria-labelledby={`tab-${tab}`} className="stack step-2">
        {tab === 'saved' && saved && saved.length === 0 ? <EmptyState sentence="No saved jobs yet." action={{ label: 'Search jobs', to: '/jobs' }} /> : null}
        {tab === 'saved' && saved && saved.length > 0 ? <JobCards jobs={saved} label="Saved jobs" /> : null}
        {tab === 'applied' && applied && applied.length === 0 ? <EmptyState sentence="No applications yet." action={{ label: 'Search jobs', to: '/jobs' }} /> : null}
        {tab === 'applied' && applied && applied.length > 0 ? (
          <ul className="plain-list job-cards" aria-label="Applications">
            {applied.map((job) =>
              job.my_application ? (
                <li key={job.my_application.id} className="job-card surface stack-s" data-application-id={job.my_application.id} data-state={job.my_application.state} data-job-id={job.id}>
                  <h2 className="job-card-title">
                    <Link to={`/jobs/${job.id}`}>{job.title}</Link>
                  </h2>
                  <p className="muted">{job.company.name}</p>
                  <p className="t-larger">{job.my_application.status_text}</p>
                  <HistoryList title={job.title} history={job.my_application.history ?? []} viewer="applicant" />
                  {job.my_application.moves?.includes('withdrawn') ? (
                    <div>
                      <Button onClick={() => setWithdrawing({ applicationId: job.my_application?.id ?? '', title: job.title })}>Withdraw application</Button>
                    </div>
                  ) : null}
                </li>
              ) : null,
            )}
          </ul>
        ) : null}
      </div>
      <Dialog name="Withdraw application?" open={withdrawing !== null} onClose={() => setWithdrawing(null)}>
        <div className="stack">
          <h2 className="t-larger">Withdraw application?</h2>
          <p>{withdrawing ? `Your application for ${withdrawing.title} will be withdrawn.` : ''}</p>
          <div className="dialog-actions">
            <Button onClick={() => void withdraw()} disabled={pending}>
              Withdraw
            </Button>
            <Button onClick={() => setWithdrawing(null)}>Cancel</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
