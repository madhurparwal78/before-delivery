import { businessNow } from '../server/clock';
import { query } from '../server/db';
import { newId } from '../server/ids';
import { STAGE_STATUS_TEXT, type ApplicationState } from '../shared/format';
import { isLegalTransition } from '../shared/stages';
import type { QuestionRow } from './jobs';

export { isLegalTransition };

export type ApplicationRow = {
  id: string;
  job_id: string;
  applicant_id: string;
  state: ApplicationState;
  created_at: Date;
  entered_at: Date;
  resume_id: string | null;
  answers: Record<string, unknown>;
};

export const APPLICATION_COLUMNS =
  'id, job_id, applicant_id, state, created_at, entered_at, resume_id, answers';

export type HistoryBy = 'you' | 'hiring_team' | 'automatic';

export async function applicationById(id: string): Promise<ApplicationRow | null> {
  const rows = await query<ApplicationRow>(
    `SELECT ${APPLICATION_COLUMNS} FROM applications WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function addHistory(
  applicationId: string,
  state: ApplicationState,
  by: HistoryBy,
  reason: string | null,
): Promise<void> {
  const rows = await query<{ next: number }>(
    'SELECT coalesce(max(seq), 0) + 1 AS next FROM application_history WHERE application_id = $1',
    [applicationId],
  );
  await query(
    `INSERT INTO application_history (id, application_id, seq, state, at, by, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [newId('hist'), applicationId, rows[0].next, state, businessNow(), by, reason],
  );
}

export async function historyOf(applicationId: string): Promise<Record<string, unknown>[]> {
  const rows = await query<{ state: string; at: Date; by: string; reason: string | null }>(
    'SELECT state, at, by, reason FROM application_history WHERE application_id = $1 ORDER BY seq',
    [applicationId],
  );
  return rows.map((row) => ({
    state: row.state,
    status_text: STAGE_STATUS_TEXT[row.state],
    at: row.at.toISOString(),
    by: row.by,
    reason: row.reason,
  }));
}

export async function applicationObject(
  application: ApplicationRow,
  extras: { applicant?: Record<string, unknown>; resumeUrl?: string | null } = {},
): Promise<Record<string, unknown>> {
  const job = (
    await query<{ id: string; title: string; company_id: string }>(
      'SELECT id, title, company_id FROM jobs WHERE id = $1',
      [application.job_id],
    )
  )[0];
  const company = (
    await query<{ id: string; name: string }>('SELECT id, name FROM companies WHERE id = $1', [
      job.company_id,
    ])
  )[0];
  const body: Record<string, unknown> = {
    id: application.id,
    job: { id: job.id, title: job.title, company: { id: company.id, name: company.name } },
    state: application.state,
    status_text: STAGE_STATUS_TEXT[application.state],
    history: await historyOf(application.id),
  };
  if (extras.applicant) body.applicant = extras.applicant;
  if (extras.resumeUrl !== undefined) body.resume_url = extras.resumeUrl;
  return body;
}

/** Each question gets the first of these checks it fails. */
export function checkAnswers(
  questions: QuestionRow[],
  answers: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const known = new Set(questions.map((question) => question.id));
  for (const key of Object.keys(answers)) {
    if (!known.has(key)) {
      errors.answers = "Answer only this job's questions.";
      break;
    }
  }
  for (const question of questions) {
    const value = answers[question.id];
    const blank =
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim() === '');
    const field = `answers.${question.id}`;
    if (question.required && blank) {
      errors[field] = 'Answer this question.';
      continue;
    }
    if (blank) continue;
    if (question.type === 'number') {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        errors[field] = 'Enter a whole number.';
      }
      continue;
    }
    if (question.type === 'single_choice') {
      if (typeof value !== 'string' || !(question.options ?? []).includes(value)) {
        errors[field] = 'Choose one of the options.';
      }
      continue;
    }
    if (question.type === 'yes_no') {
      if (value !== 'yes' && value !== 'no') errors[field] = 'Choose Yes or No.';
      continue;
    }
    if (typeof value !== 'string' || [...value].length > 500) {
      errors[field] = 'Keep this under 500 characters.';
    }
  }
  return errors;
}

/** The first knock-out question the answers miss, in question order. */
export function firstKnockOutMiss(
  questions: QuestionRow[],
  answers: Record<string, unknown>,
): QuestionRow | null {
  for (const question of questions) {
    if (!question.knock_out) continue;
    const value = answers[question.id];
    const blank =
      value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
    if (blank) return question;
    if (question.type === 'yes_no' && value !== question.ideal) return question;
    if (question.type === 'single_choice' && !(question.accepted ?? []).includes(String(value))) {
      return question;
    }
    if (question.type === 'number' && typeof value === 'number') {
      if (question.minimum !== null && value < question.minimum) return question;
      if (question.maximum !== null && value > question.maximum) return question;
    }
  }
  return null;
}

export type FunnelRow = { stage: string; count: number; rate: number | null };

/** The published hiring funnel, from the job's applications. */
export async function funnelFor(
  jobId: string,
): Promise<{ rows: FunnelRow[]; median_first_view_minutes: number | null; automatic: number }> {
  const applications = await query<{ id: string; state: string }>(
    'SELECT id, state FROM applications WHERE job_id = $1',
    [jobId],
  );
  const reached = { applied: 0, viewed: 0, interviewing: 0, offered: 0 };
  const firstViewMinutes: number[] = [];
  let automatic = 0;

  for (const application of applications) {
    const history = await query<{ state: string; at: Date; by: string }>(
      'SELECT state, at, by FROM application_history WHERE application_id = $1 ORDER BY seq',
      [application.id],
    );
    const states = new Set(history.map((entry) => entry.state));
    for (const stage of ['applied', 'viewed', 'interviewing', 'offered'] as const) {
      if (states.has(stage)) reached[stage] += 1;
    }
    const appliedAt = history.find((entry) => entry.state === 'applied');
    const viewedAt = history.find((entry) => entry.state === 'viewed');
    if (appliedAt && viewedAt) {
      firstViewMinutes.push(
        Math.floor((viewedAt.at.getTime() - appliedAt.at.getTime()) / 60000),
      );
    }
    if (
      application.state === 'rejected' &&
      history.some((entry) => entry.state === 'rejected' && entry.by === 'automatic')
    ) {
      automatic += 1;
    }
  }

  const rate = (count: number, previous: number): number | null =>
    previous === 0 ? null : Math.round((count / previous) * 100);

  const rows: FunnelRow[] = [
    { stage: 'applied', count: reached.applied, rate: reached.applied === 0 ? null : 100 },
    { stage: 'viewed', count: reached.viewed, rate: rate(reached.viewed, reached.applied) },
    {
      stage: 'interviewing',
      count: reached.interviewing,
      rate: rate(reached.interviewing, reached.viewed),
    },
    { stage: 'offered', count: reached.offered, rate: rate(reached.offered, reached.interviewing) },
    {
      stage: 'rejected',
      count: applications.filter((application) => application.state === 'rejected').length,
      rate: null,
    },
    {
      stage: 'withdrawn',
      count: applications.filter((application) => application.state === 'withdrawn').length,
      rate: null,
    },
  ];

  firstViewMinutes.sort((a, b) => a - b);
  let median: number | null = null;
  if (firstViewMinutes.length > 0) {
    const middle = Math.floor((firstViewMinutes.length - 1) / 2);
    median = firstViewMinutes[middle];
  }
  return { rows, median_first_view_minutes: median, automatic };
}
