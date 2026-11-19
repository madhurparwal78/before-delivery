import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { announce } from '../announce';
import { ApiError, api } from '../api';
import { ApplicationDialog, type ApplicationTarget } from '../components/jobs/ApplicationDialog';
import { Board } from '../components/jobs/Board';
import { Funnel } from '../components/jobs/Funnel';
import { NotAvailable } from '../components/jobs/NotAvailable';
import { SOMETHING_WENT_WRONG, type BoardCard, type BoardColumns, type Funnel as FunnelData, type JobObject } from '../components/jobs/jobModel';
import { useLive } from '../live';
import type { ApplicationState } from '../types';
import { Alert } from '../ui';
import '../components/jobs/jobs.css';

/** The poster's applicants board and hiring funnel for one job. */
export default function Applicants() {
  const { jobId = '' } = useParams();
  const [job, setJob] = useState<JobObject | null>(null);
  const [columns, setColumns] = useState<BoardColumns | null>(null);
  const [funnel, setFunnel] = useState<FunnelData | null>(null);
  const [denied, setDenied] = useState(false);
  const [alert, setAlert] = useState('');
  const [opened, setOpened] = useState<ApplicationTarget | null>(null);
  const [focusCard, setFocusCard] = useState<{ id: string; n: number } | null>(null);

  const load = async (): Promise<void> => {
    try {
      const [board, summary] = await Promise.all([
        api.get<{ columns: BoardColumns }>(`/api/jobs/${jobId}/applications`),
        api.get<FunnelData>(`/api/jobs/${jobId}/funnel`),
      ]);
      setColumns(board.columns);
      setFunnel(summary);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 403 || error.status === 404)) setDenied(true);
      else setAlert(SOMETHING_WENT_WRONG);
    }
  };

  useEffect(() => {
    void load();
    api.get<JobObject>(`/api/jobs/${jobId}`).then(setJob, () => setDenied(true));
  }, [jobId]);
  useLive(['application', 'reconnected'], (event) => {
    if (event.type === 'application' && event.job_id !== jobId) return;
    void load();
  });

  const move = async (card: BoardCard, to: ApplicationState): Promise<void> => {
    setAlert('');
    const label = (state: ApplicationState): string => job?.stages.find((stage) => stage.state === state)?.label ?? state;
    try {
      await api.post(`/api/applications/${card.id}/transition`, { to });
      announce('Jobs announcements', `Moved ${card.applicant.name} to ${label(to)}`);
    } catch (error) {
      if (error instanceof ApiError && error.body.error === 'invalid_transition') setAlert(`This application already moved to ${label(error.body.from as ApplicationState)}.`);
      else setAlert(SOMETHING_WENT_WRONG);
    }
    await load();
    setFocusCard((current) => ({ id: card.id, n: (current?.n ?? 0) + 1 }));
  };

  if (denied) return <NotAvailable />;
  if (!job || !columns || !funnel) return null;

  return (
    <div className="stack applicants-page">
      <header className="stack-s">
        <h1 className="page-title">Applicants</h1>
        <p className="t-larger">
          <Link to={`/jobs/${job.id}`}>{job.title}</Link>
        </p>
      </header>
      <Funnel funnel={funnel} stages={job.stages} />
      <Alert>{alert}</Alert>
      <Board columns={columns} stages={job.stages} onMove={move} onOpen={(card) => setOpened({ id: card.id, name: card.applicant.name })} focusCardId={focusCard} />
      <ApplicationDialog target={opened} onClose={() => setOpened(null)} />
    </div>
  );
}
