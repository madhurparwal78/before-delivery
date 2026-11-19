import { jobIsOpen, now } from '../clock.js';
import { lockKey, maybeRow, oneRow, rows, transaction, type Db, type Tx, publishAfterCommit } from '../db.js';
import { conflict, notFound, validation } from '../errors.js';
import { newId } from '../ids.js';
import { queueMail } from '../mail.js';
import type { Created } from '../idempotency.js';
import { APPLICATION_STATES, assertMove, historyByRole, isApplicationState, legalTargets, statusText, type ApplicationRole, type ApplicationState, type HistoryBy } from './application-stages.js';
import { historyOf } from './application-history.js';
import { questionsOf } from './jobs.js';
import { notify } from './notify.js';
import { personCards } from './people.js';
import { checkAnswers, firstKnockOutMiss } from './screening.js';
import { requireOwnResume } from './resumes.js';

interface ApplicationRow {
  id: string;
  job_id: string;
  applicant_id: string;
  state: ApplicationState;
  resume_id: string | null;
  entered_at: Date;
  job_title: string;
  closes_at: Date;
  poster_id: string;
  company_id: string;
  company_name: string;
}

const APPLICATION_SELECT = `
  SELECT a.id, a.job_id, a.applicant_id, a.state, a.resume_id, a.entered_at, j.title AS job_title, j.closes_at, j.poster_id,
         c.id AS company_id, c.name AS company_name
    FROM applications a JOIN jobs j ON j.id = a.job_id JOIN companies c ON c.id = j.company_id`;

/** The viewer's relation to an application; anyone else gets not found. */
function roleOf(row: ApplicationRow, viewerId: string): ApplicationRole {
  if (row.applicant_id === viewerId) return 'applicant';
  if (row.poster_id === viewerId) return 'poster';
  throw notFound();
}

async function applicationRow(db: Db, id: string, lock = false): Promise<ApplicationRow> {
  const row = await maybeRow<ApplicationRow>(db, `${APPLICATION_SELECT} WHERE a.id = $1${lock ? ' FOR UPDATE OF a' : ''}`, [id]);
  if (!row) throw notFound();
  return row;
}

async function applicationObject(db: Db, row: ApplicationRow, role: ApplicationRole): Promise<Record<string, unknown>> {
  const application: Record<string, unknown> = {
    id: row.id,
    job: { id: row.job_id, title: row.job_title, company: { id: row.company_id, name: row.company_name } },
    state: row.state,
    status_text: statusText(row.state),
    history: await historyOf(db, row.id),
    moves: legalTargets(role, row.state),
  };
  if (role === 'poster') {
    const [card] = await personCards(db, row.poster_id, [row.applicant_id]);
    const applicant = await oneRow<{ id: string; handle: string; name: string; headline: string }>(db, 'SELECT id, handle, name, headline FROM members WHERE id = $1', [row.applicant_id]);
    application.applicant = card ?? applicant;
    application.resume_url = row.resume_id ? `/api/applications/${row.id}/resume` : null;
  }
  return application;
}

/** Writes a stage change with its history entry, tells both parties' pages and mails a rejection. */
async function recordMove(tx: Tx, row: ApplicationRow, to: ApplicationState, by: HistoryBy, reason: string | null, at: Date): Promise<void> {
  await tx.query('UPDATE applications SET state = $2, entered_at = $3 WHERE id = $1', [row.id, to, at]);
  await tx.query('INSERT INTO application_history (application_id, state, at, by, reason) VALUES ($1, $2, $3, $4, $5)', [row.id, to, at, by, reason]);
  publishAfterCommit(tx, [row.applicant_id, row.poster_id], { type: 'application', application_id: row.id, job_id: row.job_id, state: to });
  await notify(tx, {
    memberId: row.applicant_id,
    kind: 'application_status',
    actorId: by === 'you' ? row.applicant_id : row.poster_id,
    detail: `Your application for ${row.job_title} is now: ${statusText(to)}.`,
  });
  if (to === 'rejected') {
    const applicant = await oneRow<{ email: string }>(tx, 'SELECT email FROM members WHERE id = $1', [row.applicant_id]);
    await queueMail(tx, {
      to: applicant.email,
      subject: `Update on your application for ${row.job_title}`,
      text: `Thank you for applying for ${row.job_title}. The hiring team has decided not to move your application forward.\n`,
    });
  }
}

export interface ApplyInput {
  resume_id?: unknown;
  answers?: unknown;
}

/** Part of applying that must not run twice: the resume must be the applicant's own (404 otherwise). */
export async function checkApplyTargets(db: Db, memberId: string, jobId: string, input: ApplyInput): Promise<void> {
  if (!(await maybeRow(db, 'SELECT 1 FROM jobs WHERE id = $1', [jobId]))) throw notFound();
  if (typeof input.resume_id === 'string') await requireOwnResume(db, memberId, input.resume_id);
}

/** Creates the application in one transaction: one per member and job, answers checked, a knock-out miss rejected at once. */
export async function applyToJob(tx: Tx, memberId: string, jobId: string, input: ApplyInput): Promise<Created> {
  await lockKey(tx, `application:${jobId}:${memberId}`);
  const existing = await maybeRow<{ id: string }>(tx, 'SELECT id FROM applications WHERE job_id = $1 AND applicant_id = $2', [jobId, memberId]);
  if (existing) throw conflict('already_applied', { application_id: existing.id });
  const job = await oneRow<{ closes_at: Date }>(tx, 'SELECT closes_at FROM jobs WHERE id = $1', [jobId]);
  const at = now();
  if (!jobIsOpen(job.closes_at, at)) throw conflict('job_closed');
  // Shared lock on the questions version: the editor's questions save (which takes it for update) cannot change them under this check.
  await tx.query(`SELECT 1 FROM job_field_versions WHERE job_id = $1 AND field = 'questions' FOR SHARE`, [jobId]);
  const questions = await questionsOf(tx, jobId);
  const fields = checkAnswers(questions, input.answers ?? {});
  if (typeof input.resume_id !== 'string') fields.resume_id = 'Attach your resume.';
  if (Object.keys(fields).length > 0) throw validation(fields);

  const id = newId();
  const answers = input.answers ?? {};
  await tx.query(
    'INSERT INTO applications (id, job_id, applicant_id, state, answers, resume_id, created_at, entered_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)',
    [id, jobId, memberId, 'applied', JSON.stringify(answers), input.resume_id, at],
  );
  await tx.query('INSERT INTO application_history (application_id, state, at, by, reason) VALUES ($1, $2, $3, $4, NULL)', [id, 'applied', at, 'you']);
  const row = await applicationRow(tx, id);
  publishAfterCommit(tx, [row.applicant_id, row.poster_id], { type: 'application', application_id: id, job_id: jobId, state: 'applied' });
  const missed = firstKnockOutMiss(questions, answers);
  if (missed !== null) {
    await recordMove(tx, row, 'rejected', 'automatic', missed, at);
  }
  return { status: 201, body: await applicationObject(tx, await applicationRow(tx, id), 'applicant') };
}

/** Reads an application. The poster's first read moves it from applied to viewed. */
export async function readApplication(viewerId: string, id: string): Promise<Record<string, unknown>> {
  return transaction(async (tx) => {
    let row = await applicationRow(tx, id, true);
    const role = roleOf(row, viewerId);
    if (role === 'poster' && row.state === 'applied') {
      await recordMove(tx, row, 'viewed', 'hiring_team', null, now());
      row = await applicationRow(tx, id);
    }
    return applicationObject(tx, row, role);
  });
}

/** Moves an application along the published stages by the role the stage names. */
export async function transition(viewerId: string, id: string, to: unknown): Promise<Record<string, unknown>> {
  return transaction(async (tx) => {
    const row = await applicationRow(tx, id, true);
    const role = roleOf(row, viewerId);
    if (!isApplicationState(to)) throw validation({ to: 'Choose a stage.' });
    assertMove(role, row.state, to);
    await recordMove(tx, row, to, historyByRole(role), null, now());
    return applicationObject(tx, await applicationRow(tx, id), role);
  });
}

/** The posters' board: one column per stage, oldest entry first. */
export async function boardColumns(db: Db, jobId: string): Promise<Record<ApplicationState, unknown[]>> {
  const cards = await rows<{ id: string; state: ApplicationState; entered_at: Date; applicant_id: string; name: string; handle: string; headline: string }>(
    db,
    `SELECT a.id, a.state, a.entered_at, m.id AS applicant_id, m.name, m.handle, m.headline
       FROM applications a JOIN members m ON m.id = a.applicant_id WHERE a.job_id = $1 ORDER BY a.entered_at, a.id`,
    [jobId],
  );
  const columns = Object.fromEntries(APPLICATION_STATES.map((state) => [state, [] as unknown[]])) as Record<ApplicationState, unknown[]>;
  for (const card of cards) {
    columns[card.state].push({
      id: card.id,
      applicant: { id: card.applicant_id, name: card.name, handle: card.handle, headline: card.headline },
      state: card.state,
      entered_at: card.entered_at.toISOString(),
      moves: legalTargets('poster', card.state),
    });
  }
  return columns;
}

/** The stored resume key of an application the viewer may see. */
export async function applicationResumeKey(db: Db, viewerId: string, id: string): Promise<string> {
  const row = await applicationRow(db, id);
  roleOf(row, viewerId);
  const resume = row.resume_id ? await maybeRow<{ object_key: string }>(db, 'SELECT object_key FROM resumes WHERE id = $1', [row.resume_id]) : undefined;
  if (!resume) throw notFound();
  return resume.object_key;
}
