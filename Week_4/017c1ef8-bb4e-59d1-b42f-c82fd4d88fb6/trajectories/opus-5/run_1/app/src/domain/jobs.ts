import { businessNow } from '../server/clock';
import { query } from '../server/db';
import { STAGE_LABELS, STAGE_ORDER, STAGE_STATUS_TEXT } from '../shared/format';

export type JobRow = {
  id: string;
  company_id: string;
  poster_id: string;
  title: string;
  location: string;
  workplace: string;
  description: string;
  posted_at: Date;
  closes_at: Date;
  versions: Record<string, number>;
  field_editors: Record<string, { id: string; name: string }>;
};

export const JOB_COLUMNS =
  'id, company_id, poster_id, title, location, workplace, description, posted_at, closes_at, versions, field_editors';

export type QuestionRow = {
  id: string;
  job_id: string;
  position: number;
  type: string;
  text: string;
  required: boolean;
  knock_out: boolean;
  ideal: string | null;
  options: string[] | null;
  accepted: string[] | null;
  minimum: number | null;
  maximum: number | null;
};

export async function jobById(id: string): Promise<JobRow | null> {
  const rows = await query<JobRow>(`SELECT ${JOB_COLUMNS} FROM jobs WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

/** A job is open while the business clock is before its closing instant. */
export function jobOpen(job: JobRow): boolean {
  return businessNow().getTime() < job.closes_at.getTime();
}

export async function isCompanyAdmin(memberId: string, companyId: string): Promise<boolean> {
  const rows = await query<{ one: number }>(
    'SELECT 1 AS one FROM company_admins WHERE company_id = $1 AND member_id = $2',
    [companyId, memberId],
  );
  return rows.length > 0;
}

export async function questionsOf(jobId: string): Promise<QuestionRow[]> {
  return query<QuestionRow>(
    `SELECT id, job_id, position, type, text, required, knock_out, ideal, options, accepted, minimum, maximum
     FROM job_questions WHERE job_id = $1 ORDER BY position`,
    [jobId],
  );
}

export function questionObject(row: QuestionRow, admin: boolean): Record<string, unknown> {
  if (!admin) {
    return {
      id: row.id,
      type: row.type,
      text: row.text,
      required: row.required,
      options: row.type === 'single_choice' ? row.options : null,
    };
  }
  return {
    id: row.id,
    type: row.type,
    text: row.text,
    required: row.required,
    knock_out: row.knock_out,
    ideal: row.type === 'yes_no' ? row.ideal : null,
    options: row.type === 'single_choice' ? row.options : null,
    accepted: row.type === 'single_choice' ? row.accepted : null,
    minimum: row.type === 'number' ? row.minimum : null,
    maximum: row.type === 'number' ? row.maximum : null,
  };
}

export type CompanyRef = { id: string; name: string; handle: string };

export async function companyRef(companyId: string): Promise<CompanyRef> {
  const rows = await query<CompanyRef>('SELECT id, name, handle FROM companies WHERE id = $1', [
    companyId,
  ]);
  return rows[0];
}

export async function jobCard(viewerId: string, job: JobRow): Promise<Record<string, unknown>> {
  const saved = await query<{ one: number }>(
    'SELECT 1 AS one FROM saved_jobs WHERE member_id = $1 AND job_id = $2',
    [viewerId, job.id],
  );
  const applied = await query<{ one: number }>(
    'SELECT 1 AS one FROM applications WHERE applicant_id = $1 AND job_id = $2',
    [viewerId, job.id],
  );
  return {
    id: job.id,
    title: job.title,
    company: await companyRef(job.company_id),
    location: job.location,
    workplace: job.workplace,
    posted_at: job.posted_at.toISOString(),
    closes_at: job.closes_at.toISOString(),
    open: jobOpen(job),
    saved: saved.length > 0,
    applied: applied.length > 0,
  };
}

/** The published hiring stages, as shown on every job page. */
export function hiringStages(): {
  state: string;
  label: string;
  status_text: string;
  moved_by: string;
}[] {
  const movedBy: Record<string, string> = {
    applied: 'applicant',
    viewed: 'system',
    interviewing: 'poster',
    offered: 'poster',
    rejected: 'poster',
    withdrawn: 'applicant',
  };
  return STAGE_ORDER.map((state) => ({
    state,
    label: STAGE_LABELS[state],
    status_text: STAGE_STATUS_TEXT[state],
    moved_by: movedBy[state],
  }));
}
