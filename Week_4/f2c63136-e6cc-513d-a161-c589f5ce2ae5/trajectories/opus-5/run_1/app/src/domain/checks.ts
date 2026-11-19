import { config } from '../server/config.js';
import { serverNow } from '../server/clock.js';
import type { Db } from '../server/db.js';
import { byteOrder } from './revisions.js';

export type CheckState = 'queued' | 'in_progress' | 'success' | 'failure' | 'timed_out';
export type ReportState = 'queued' | 'in_progress' | 'success' | 'failure';

export const CHECK_STATE_WORDS: Record<CheckState, string> = {
  queued: 'Queued',
  in_progress: 'In progress',
  success: 'Passed',
  failure: 'Failed',
  timed_out: 'Timed out',
};

export interface CheckRowView {
  name: string;
  state: CheckState;
  summary: string;
  required: boolean;
  timeoutAt: Date | null;
}

export interface LatestReport {
  name: string;
  state: ReportState;
  summary: string;
}

export async function latestReports(tx: Db, repoId: number, revisionId: string): Promise<Map<string, LatestReport>> {
  const rows = await tx.query<{ name: string; state: ReportState; summary: string }>(
    `SELECT name, state, summary FROM rs_check_reports WHERE repo_id = $1 AND revision_id = $2 ORDER BY id`,
    [repoId, revisionId],
  );
  const latest = new Map<string, LatestReport>();
  for (const row of rows) {
    latest.set(row.name, { name: row.name, state: row.state, summary: row.summary });
  }
  return latest;
}

export function timeoutDeadline(revisionTime: Date): Date {
  return new Date(revisionTime.getTime() + config.checkTimeoutSeconds * 1000);
}

export function isTimedOut(report: LatestReport | undefined, deadline: Date): boolean {
  if (report && (report.state === 'success' || report.state === 'failure')) return false;
  return serverNow().getTime() >= deadline.getTime();
}

/**
 * The rows shown for a revision: every required name in byte order, then every other reported
 * name in byte order. Timeouts are judged against the revision's deadline.
 */
export function checkRows(
  requiredNames: string[],
  reports: Map<string, LatestReport>,
  revisionTime: Date | null,
): CheckRowView[] {
  const deadline = revisionTime === null ? null : timeoutDeadline(revisionTime);
  const required = [...new Set(requiredNames)].sort(byteOrder);
  const others = [...reports.keys()].filter((name) => !required.includes(name)).sort(byteOrder);

  const rows: CheckRowView[] = [];
  for (const name of required) {
    const report = reports.get(name);
    const timedOut = deadline !== null && isTimedOut(report, deadline);
    const state: CheckState = timedOut ? 'timed_out' : report ? report.state : 'queued';
    rows.push({
      name,
      state,
      summary: report ? report.summary : '',
      required: true,
      timeoutAt: deadline !== null && (state === 'queued' || state === 'in_progress') ? deadline : null,
    });
  }
  for (const name of others) {
    const report = reports.get(name)!;
    rows.push({ name, state: report.state, summary: report.summary, required: false, timeoutAt: null });
  }
  return rows;
}
