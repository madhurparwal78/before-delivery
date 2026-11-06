import { useState, type ReactNode } from 'react';
import type { Job } from '../../shared/types';
import { estimateLabel } from '../copy';
import { api } from '../lib/api';
import { useFirstLoad, useReread, useStatus } from '../lib/hooks';
import { Link, navigate } from '../lib/router';
import { EstimateDialog } from './EstimateDialog';
import { StatusRegion } from '../components/Status';

export function JobsScreen(): ReactNode {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const status = useStatus();

  const load = async (): Promise<void> => {
    const outcome = await api<{ jobs: Job[] }>('/api/jobs');
    if (outcome.kind === 'ok') setJobs(outcome.body.jobs);
  };

  useFirstLoad(load);
  useReread(load, 10_000, jobs.some((job) => job.status === 'sent'));

  return (
    <div className="screen jobs-screen">
      <h1>Jobs</h1>
      <button type="button" onClick={() => setNewOpen(true)}>
        New estimate
      </button>
      <table className="data-table">
        <caption className="visually-hidden">Jobs</caption>
        <thead>
          <tr>
            <th scope="col">Number</th>
            <th scope="col">Car</th>
            <th scope="col">Title</th>
            <th scope="col">Status</th>
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id}>
              <th scope="row" className="mono">
                <Link to={`/jobs/${job.id}`}>{job.number}</Link>
              </th>
              <td>{job.car.name}</td>
              <td>{job.title}</td>
              <td>{estimateLabel(job.status, job.expires_at)}</td>
              <td className="mono">{`CHF ${job.total}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {newOpen ? (
        <EstimateDialog
          status={status}
          job={null}
          onClose={() => setNewOpen(false)}
          onSaved={(job) => {
            setNewOpen(false);
            navigate(`/jobs/${job.id}`);
          }}
        />
      ) : null}
      <StatusRegion name="Job updates" status={status} />
    </div>
  );
}
