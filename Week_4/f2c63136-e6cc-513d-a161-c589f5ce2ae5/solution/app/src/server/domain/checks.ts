import type { Db, Row } from '../db.ts';
import { config } from '../config.ts';
import { iso, now } from '../clock.ts';
import { workspaceTime } from '../format.ts';
import { CHECK_WORD, type CheckRow, type CheckState } from '../../shared/types.ts';
import { byteOrder } from './validate.ts';

interface Report {
  name: string;
  state: CheckState;
  summary: string;
}

const deadlineOf = (revisionCreated: Date): Date => new Date(revisionCreated.getTime() + config.checkTimeoutSeconds * 1000);

export async function latestReports(db: Db, repoId: number, revision: string): Promise<Map<string, Report>> {
  const rows = await db.q<Row>(
    `SELECT DISTINCT ON (name) name, state, summary FROM check_reports
      WHERE repo_id = $1 AND revision = $2 ORDER BY name, id DESC`,
    [repoId, revision],
  );
  return new Map(rows.map((row) => [row.name, { name: row.name, state: row.state, summary: row.summary }]));
}

const FINAL: CheckState[] = ['success', 'failure', 'timed_out'];
export const isFinal = (state: CheckState): boolean => FINAL.includes(state);

/**
 * The state of one check name on a revision. A required name without a final report is timed out
 * from the moment the server clock reaches the revision's creation time plus the timeout.
 */
export function checkState(report: Report | undefined, required: boolean, created: Date, timeouts: boolean): CheckState {
  const reported = report?.state ?? 'queued';
  if (isFinal(reported)) return reported;
  return required && timeouts && now() >= deadlineOf(created) ? 'timed_out' : reported;
}

/** Required names in byte order, then every other reported name in byte order. */
export function checkRows(reports: Map<string, Report>, requiredChecks: string[], created: Date, timeouts: boolean): CheckRow[] {
  const required = [...requiredChecks].sort(byteOrder);
  const others = [...reports.keys()].filter((name) => !requiredChecks.includes(name)).sort(byteOrder);
  const due = deadlineOf(created);
  return [...required, ...others].map((name) => {
    const isRequired = requiredChecks.includes(name);
    const report = reports.get(name);
    const state = checkState(report, isRequired, created, timeouts);
    const waiting = isRequired && (state === 'queued' || state === 'in_progress');
    return {
      name,
      state,
      word: CHECK_WORD[state],
      summary: report?.summary ?? '',
      timeout_at: waiting ? { iso: iso(due), shown: workspaceTime(due) } : null,
    };
  });
}

/** Required names that are not yet passed, in byte order, with their state. */
export function unmetChecks(rows: CheckRow[], requiredChecks: string[]): CheckRow[] {
  return rows.filter((row) => requiredChecks.includes(row.name) && row.state !== 'success');
}
