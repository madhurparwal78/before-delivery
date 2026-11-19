import { closedBetweenSql, jobIsOpen, now } from '../clock.js';
import { maybeRow, oneRow, pool, rows, type Db, type Tx, publishAfterCommit } from '../db.js';
import { conflict, forbidden, notFound, unprocessable, validation } from '../errors.js';
import { newId } from '../ids.js';
import { publish, publishToEditors } from '../live.js';
import { onTick } from '../tick.js';
import { legalTargets, publishedStages, statusText, type ApplicationState } from './application-stages.js';
import { MAX_QUESTIONS, checkQuestions, publicQuestion, tooManyQuestions, withIds, type Question, type QuestionInput } from './screening.js';
import { isCompanyAdmin, isJobAdmin } from './company-admins.js';
import { othersEditing } from './editor-presence.js';
import { historyOf } from './application-history.js';
import { lengthOutside } from './text.js';

export type Workplace = 'on-site' | 'hybrid' | 'remote';
const WORKPLACES: Workplace[] = ['on-site', 'hybrid', 'remote'];

export type JobField = 'title' | 'location' | 'workplace' | 'closes_at' | 'description' | 'questions';
export const JOB_FIELDS: JobField[] = ['title', 'location', 'workplace', 'closes_at', 'description', 'questions'];

interface JobRow {
  id: string;
  company_id: string;
  company_name: string;
  company_handle: string;
  poster_id: string;
  title: string;
  location: string;
  workplace: Workplace;
  description: string;
  posted_at: Date;
  closes_at: Date;
  saved: boolean;
  application_id: string | null;
  application_state: ApplicationState | null;
}

export interface JobCard {
  id: string;
  title: string;
  company: { id: string; name: string; handle: string };
  location: string;
  workplace: Workplace;
  posted_at: string;
  closes_at: string;
  open: boolean;
  saved: boolean;
  applied: boolean;
}

interface MyApplication {
  id: string;
  state: ApplicationState;
  status_text: string;
}

const JOB_SELECT = `
  SELECT j.id, j.company_id, c.name AS company_name, c.handle AS company_handle, j.poster_id, j.title, j.location, j.workplace,
         j.description, j.posted_at, j.closes_at,
         EXISTS (SELECT 1 FROM saved_jobs s WHERE s.job_id = j.id AND s.member_id = $1) AS saved,
         a.id AS application_id, a.state AS application_state
    FROM jobs j
    JOIN companies c ON c.id = j.company_id
    LEFT JOIN applications a ON a.job_id = j.id AND a.applicant_id = $1`;

const cardOf = (row: JobRow, at: Date): JobCard => ({
  id: row.id,
  title: row.title,
  company: { id: row.company_id, name: row.company_name, handle: row.company_handle },
  location: row.location,
  workplace: row.workplace,
  posted_at: row.posted_at.toISOString(),
  closes_at: row.closes_at.toISOString(),
  open: jobIsOpen(row.closes_at, at),
  saved: row.saved,
  applied: row.application_id !== null,
});

const myApplicationOf = (row: JobRow): MyApplication | null =>
  row.application_id && row.application_state ? { id: row.application_id, state: row.application_state, status_text: statusText(row.application_state) } : null;

/** Job cards for the ids, in the order given, as the viewer sees them. */
export async function jobCards(db: Db, viewerId: string, jobIds: string[]): Promise<JobCard[]> {
  if (jobIds.length === 0) return [];
  const at = now();
  const found = await rows<JobRow>(db, `${JOB_SELECT} WHERE j.id = ANY($2)`, [viewerId, jobIds]);
  const byId = new Map(found.map((row) => [row.id, row]));
  return jobIds.flatMap((id) => {
    const row = byId.get(id);
    return row ? [cardOf(row, at)] : [];
  });
}

export async function questionsOf(db: Db, jobId: string): Promise<Question[]> {
  return rows<Question>(
    db,
    `SELECT id, type, text, required, knock_out, ideal, options, accepted, minimum, maximum
       FROM job_questions WHERE job_id = $1 ORDER BY position`,
    [jobId],
  );
}

/** The job as an admin of its company would edit it: 404 to anyone else. */
export async function requireJobAdmin(db: Db, memberId: string, jobId: string): Promise<void> {
  if (!(await isJobAdmin(db, memberId, jobId))) throw notFound();
}

/** 403 `not_poster` unless the viewer posted the job (404 when there is no such job). */
export async function requireJobPoster(db: Db, viewerId: string, jobId: string): Promise<void> {
  const job = await maybeRow<{ poster_id: string }>(db, 'SELECT poster_id FROM jobs WHERE id = $1', [jobId]);
  if (!job) throw notFound();
  if (job.poster_id !== viewerId) throw forbidden('not_poster');
}

async function requireJob(db: Db, viewerId: string, jobId: string): Promise<JobRow> {
  const row = await maybeRow<JobRow>(db, `${JOB_SELECT} WHERE j.id = $2`, [viewerId, jobId]);
  if (!row) throw notFound();
  return row;
}

export async function jobObject(db: Db, viewerId: string, jobId: string): Promise<Record<string, unknown>> {
  const row = await requireJob(db, viewerId, jobId);
  const admin = await isCompanyAdmin(db, viewerId, row.company_id);
  const questions = await questionsOf(db, jobId);
  return {
    ...cardOf(row, now()),
    description: row.description,
    questions: admin ? questions : questions.map(publicQuestion),
    stages: publishedStages(),
    my_application: myApplicationOf(row),
    is_admin: admin,
    is_poster: row.poster_id === viewerId,
  };
}

/** The single-line field and description rules, shared by publishing a job and saving one field. */
function checkJobFields(input: Record<string, unknown>, only?: JobField): Record<string, unknown> {
  const fields: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const wants = (field: JobField): boolean => only === undefined || only === field;
  const text = (field: 'title' | 'location' | 'description', max: number, message: string): void => {
    const value = typeof input[field] === 'string' ? (input[field] as string).trim() : '';
    if (!wants(field)) return;
    if (lengthOutside(value, 1, max)) fields[field] = message;
    values[field] = value;
  };
  text('title', 120, 'Enter a title of 1 to 120 characters.');
  text('location', 120, 'Enter a location of 1 to 120 characters.');
  text('description', 5000, 'Enter a description of 1 to 5,000 characters.');
  if (wants('workplace')) {
    const workplace = WORKPLACES.find((candidate) => candidate === input.workplace);
    if (!workplace) fields.workplace = 'Choose on-site, hybrid or remote.';
    values.workplace = workplace;
  }
  if (wants('closes_at')) {
    const closes = typeof input.closes_at === 'string' ? new Date(input.closes_at) : null;
    if (!closes || Number.isNaN(closes.getTime()) || !jobIsOpen(closes)) fields.closes_at = 'Pick a closing time in the future.';
    values.closes_at = closes;
  }
  if (Object.keys(fields).length > 0) throw validation(fields);
  return values;
}

export interface NewJob {
  company_id?: unknown;
  title?: unknown;
  location?: unknown;
  workplace?: unknown;
  closes_at?: unknown;
  description?: unknown;
}

export async function createJob(tx: Tx, memberId: string, input: NewJob): Promise<string> {
  const companyId = typeof input.company_id === 'string' ? input.company_id : '';
  if (!(await maybeRow(tx, 'SELECT 1 FROM companies WHERE id = $1', [companyId]))) throw notFound();
  if (!(await isCompanyAdmin(tx, memberId, companyId))) throw forbidden('not_admin');
  const values = checkJobFields({ ...input });
  const id = newId();
  await tx.query(
    `INSERT INTO jobs (id, company_id, poster_id, title, location, workplace, description, posted_at, closes_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, companyId, memberId, values.title, values.location, values.workplace, values.description, now(), values.closes_at],
  );
  await tx.query(
    `INSERT INTO job_field_versions (job_id, field, version, by_member_id) SELECT $1, unnest($2::text[]), 1, $3`,
    [id, JOB_FIELDS, memberId],
  );
  publishAfterCommit(tx, 'all', { type: 'job', job_id: id, change: 'updated' });
  return id;
}

interface FieldVersion {
  field: JobField;
  version: number;
}

type FieldValue = string | Question[];

async function editorFields(db: Db, jobId: string): Promise<Record<JobField, { value: FieldValue; version: number }>> {
  const job = await oneRow<{ title: string; location: string; workplace: string; description: string; closes_at: Date }>(
    db,
    'SELECT title, location, workplace, description, closes_at FROM jobs WHERE id = $1',
    [jobId],
  );
  const versions = await rows<FieldVersion>(db, 'SELECT field, version FROM job_field_versions WHERE job_id = $1', [jobId]);
  const version = (field: JobField): number => versions.find((entry) => entry.field === field)?.version ?? 1;
  return {
    title: { value: job.title, version: version('title') },
    location: { value: job.location, version: version('location') },
    workplace: { value: job.workplace, version: version('workplace') },
    closes_at: { value: job.closes_at.toISOString(), version: version('closes_at') },
    description: { value: job.description, version: version('description') },
    questions: { value: await questionsOf(db, jobId), version: version('questions') },
  };
}

export async function editorState(db: Db, jobId: string, memberId: string): Promise<Record<string, unknown>> {
  await requireJobAdmin(db, memberId, jobId);
  return { fields: await editorFields(db, jobId), editing: othersEditing(jobId, memberId) };
}

async function replaceQuestions(tx: Tx, jobId: string, questions: Question[]): Promise<Question[]> {
  const existing = new Set((await questionsOf(tx, jobId)).map((question) => question.id));
  const kept = withIds(questions.map((question) => (existing.has(question.id) ? question : { ...question, id: '' })));
  await tx.query('DELETE FROM job_questions WHERE job_id = $1 AND id <> ALL($2)', [jobId, kept.map((question) => question.id)]);
  for (const [index, question] of kept.entries()) {
    await tx.query(
      `INSERT INTO job_questions (id, job_id, position, type, text, required, knock_out, ideal, options, accepted, minimum, maximum)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO UPDATE SET position = $3, type = $4, text = $5, required = $6, knock_out = $7, ideal = $8,
         options = $9, accepted = $10, minimum = $11, maximum = $12`,
      [question.id, jobId, index + 1, question.type, question.text, question.required, question.knock_out, question.ideal, question.options && JSON.stringify(question.options), question.accepted && JSON.stringify(question.accepted), question.minimum, question.maximum],
    );
  }
  return kept;
}

async function writeField(tx: Tx, jobId: string, field: JobField, raw: unknown): Promise<FieldValue> {
  if (field === 'questions') {
    const list = Array.isArray(raw) ? (raw as QuestionInput[]) : [];
    if (tooManyQuestions(list.length)) throw unprocessable('too_many_questions', { limit: MAX_QUESTIONS });
    const checked = checkQuestions(list);
    if (Object.keys(checked.fields).length > 0) throw validation(checked.fields);
    return replaceQuestions(tx, jobId, checked.questions);
  }
  const values = checkJobFields({ [field]: raw }, field);
  const stored = values[field];
  await tx.query(`UPDATE jobs SET ${field} = $2 WHERE id = $1`, [jobId, stored]);
  return stored instanceof Date ? stored.toISOString() : (stored as string);
}

/** Saves one field against the version the editor read. Newer saves refuse it with the field conflict. */
export async function saveJobField(tx: Tx, jobId: string, member: { id: string; name: string }, field: JobField, raw: unknown, sentVersion: unknown): Promise<{ field: JobField; value: FieldValue; version: number }> {
  await requireJobAdmin(tx, member.id, jobId);
  // Lock the version row on its own: a join under FOR UPDATE drops the row when a concurrent save changed its editor.
  const locked = await oneRow<{ version: number; by_member_id: string }>(
    tx,
    'SELECT version, by_member_id FROM job_field_versions WHERE job_id = $1 AND field = $2 FOR UPDATE',
    [jobId, field],
  );
  const { name: by_name } = await oneRow<{ name: string }>(tx, 'SELECT name FROM members WHERE id = $1', [locked.by_member_id]);
  const current = { ...locked, by_name };
  if (field === 'questions' && (await maybeRow(tx, 'SELECT 1 FROM applications WHERE job_id = $1 LIMIT 1', [jobId]))) throw conflict('questions_locked');
  if (sentVersion !== current.version) {
    const stored = (await editorFields(tx, jobId))[field].value;
    throw conflict('field_conflict', { field, current_version: current.version, current: stored, by: { id: current.by_member_id, name: current.by_name } });
  }
  const value = await writeField(tx, jobId, field, raw);
  const version = current.version + 1;
  await tx.query('UPDATE job_field_versions SET version = $3, by_member_id = $4 WHERE job_id = $1 AND field = $2', [jobId, field, version, member.id]);
  publishAfterCommit(tx, 'all', { type: 'job', job_id: jobId, change: 'updated' });
  tx.afterCommit.push(() => publishToEditors(jobId, { type: 'job_field', job_id: jobId, field, version, by: { id: member.id, name: member.name } }, member.id));
  return { field, value, version };
}

export async function setSaved(db: Db, memberId: string, jobId: string, saved: boolean): Promise<{ saved: boolean }> {
  if (!(await maybeRow(db, 'SELECT 1 FROM jobs WHERE id = $1', [jobId]))) throw notFound();
  if (saved) {
    await db.query('INSERT INTO saved_jobs (member_id, job_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [memberId, jobId, now()]);
  } else {
    await db.query('DELETE FROM saved_jobs WHERE member_id = $1 AND job_id = $2', [memberId, jobId]);
  }
  return { saved };
}

/** The member's saved jobs (newest saved first) or applied jobs (newest application first), closed jobs included. */
export async function myJobs(db: Db, memberId: string, tab: 'saved' | 'applied'): Promise<Array<JobCard & { my_application: (MyApplication & { history?: unknown; moves?: ApplicationState[] }) | null }>> {
  const ids = await rows<{ id: string }>(
    db,
    tab === 'saved'
      ? 'SELECT job_id AS id FROM saved_jobs WHERE member_id = $1 ORDER BY created_at DESC, job_id'
      : 'SELECT job_id AS id FROM applications WHERE applicant_id = $1 ORDER BY created_at DESC, id',
    [memberId],
  );
  const at = now();
  const found = await rows<JobRow>(db, `${JOB_SELECT} WHERE j.id = ANY($2)`, [memberId, ids.map((row) => row.id)]);
  const byId = new Map(found.map((row) => [row.id, row]));
  const result = [];
  for (const { id } of ids) {
    const row = byId.get(id);
    if (!row) continue;
    const mine = myApplicationOf(row);
    if (mine && tab === 'applied') {
      result.push({ ...cardOf(row, at), my_application: { ...mine, history: await historyOf(db, mine.id), moves: legalTargets('applicant', mine.state) } });
    } else {
      result.push({ ...cardOf(row, at), my_application: mine });
    }
  }
  return result;
}

/** Tells open pages when a job's closing instant passes, whether real time or a grading move got it there. */
export function registerJobTick(): void {
  onTick(async (previous, current) => {
    const closed = await rows<{ id: string }>(pool, `SELECT j.id FROM jobs j WHERE ${closedBetweenSql('j', '$1', '$2')}`, [previous, current]);
    for (const job of closed) publish('all', { type: 'job', job_id: job.id, change: 'closed' });
  });
}
