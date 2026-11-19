import { rows, type Db } from '../db.js';
import { PROGRESS_STATES, type ApplicationState } from './application-stages.js';

interface FunnelRow {
  stage: ApplicationState;
  count: number;
  rate: number | null;
  /** Rejected row only: how many of them were rejected automatically at submit. */
  automatic?: number;
}

/** n divided by the previous row's n, times 100, rounded half up; null when there is nothing to divide by. */
const rate = (count: number, previous: number): number | null => (previous === 0 ? null : Math.floor((count * 200 + previous) / (previous * 2)));

const median = (values: number[]): number | null => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? null : (sorted[Math.floor((sorted.length - 1) / 2)] as number);
};

/** Reached counts, conversion rates and median time to first view for one job's applications. */
export async function hiringFunnel(db: Db, jobId: string): Promise<{ rows: FunnelRow[]; median_first_view_minutes: number | null }> {
  const history = await rows<{ application_id: string; state: ApplicationState; at: Date; by: string; created_at: Date; current: ApplicationState }>(
    db,
    `SELECT h.application_id, h.state, h.at, h.by, a.created_at, a.state AS current
       FROM application_history h JOIN applications a ON a.id = h.application_id
      WHERE a.job_id = $1`,
    [jobId],
  );
  const reached = (stage: ApplicationState): Set<string> => new Set(history.filter((entry) => entry.state === stage).map((entry) => entry.application_id));
  const counts = PROGRESS_STATES.map((stage) => reached(stage).size);
  const funnel: FunnelRow[] = counts.map((count, index) => ({
    stage: PROGRESS_STATES[index] as ApplicationState,
    count,
    rate: index === 0 ? (count === 0 ? null : 100) : rate(count, counts[index - 1] as number),
  }));
  const currentStates = new Map<string, ApplicationState>(history.map((entry) => [entry.application_id, entry.current]));
  const rejected = [...currentStates].filter(([, state]) => state === 'rejected').map(([id]) => id);
  const automatic = new Set(history.filter((entry) => entry.state === 'rejected' && entry.by === 'automatic').map((entry) => entry.application_id));
  funnel.push({ stage: 'rejected', count: rejected.length, rate: null, automatic: rejected.filter((id) => automatic.has(id)).length });
  funnel.push({ stage: 'withdrawn', count: [...currentStates.values()].filter((state) => state === 'withdrawn').length, rate: null });

  const appliedAt = new Map<string, Date>();
  for (const entry of history) if (entry.state === 'applied') appliedAt.set(entry.application_id, entry.at);
  const waits = history
    .filter((entry) => entry.state === 'viewed')
    .map((entry) => Math.floor((entry.at.getTime() - (appliedAt.get(entry.application_id) ?? entry.created_at).getTime()) / 60000));
  return { rows: funnel, median_first_view_minutes: median(waits) };
}
