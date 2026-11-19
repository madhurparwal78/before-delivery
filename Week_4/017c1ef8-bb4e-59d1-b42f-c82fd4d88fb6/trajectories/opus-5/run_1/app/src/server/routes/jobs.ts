import {
  addHistory,
  applicationById,
  applicationObject,
  checkAnswers,
  firstKnockOutMiss,
  funnelFor,
  isLegalTransition,
  APPLICATION_COLUMNS,
  type ApplicationRow,
} from '../../domain/applications';
import { blockExists } from '../../domain/graph';
import {
  isCompanyAdmin,
  jobById,
  jobCard,
  jobOpen,
  hiringStages,
  questionObject,
  questionsOf,
  JOB_COLUMNS,
  type JobRow,
} from '../../domain/jobs';
import { memberById, personCard } from '../../domain/members';
import { notify } from '../../domain/notifications';
import { businessNow } from '../clock';
import { MAX_QUESTIONS } from '../config';
import { query, transact } from '../db';
import { conflict, forbidden, namedValidation, notFound, storageUnavailable, validation } from '../errors';
import { newId } from '../ids';
import { jsonBody, requireMember, withIdempotency, type Ctx } from '../http';
import { jobEditorList, markJobEditor, pushJobPresence, pushTo, pushToAll } from '../live';
import { queueMail } from '../mail';
import { getObject } from '../storage';
import { STAGE_STATUS_TEXT, type ApplicationState } from '../../shared/format';

const FIELDS = ['title', 'location', 'workplace', 'closes_at', 'description', 'questions'] as const;
type JobField = (typeof FIELDS)[number];

const FIELD_LABELS: Record<JobField, string> = {
  title: 'Title',
  location: 'Location',
  workplace: 'Workplace',
  closes_at: 'Closes',
  description: 'Description',
  questions: 'Screening questions',
};

export async function getCompany(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const rows = await query<{ id: string; handle: string; name: string; location: string; about: string }>(
    'SELECT id, handle, name, location, about FROM companies WHERE lower(handle) = lower($1)',
    [ctx.params.handle],
  );
  const company = rows[0];
  if (!company) throw notFound();
  const followers = await query<{ count: string }>(
    'SELECT count(*) AS count FROM follows WHERE target_id = $1',
    [company.id],
  );
  const following = await query<{ one: number }>(
    'SELECT 1 AS one FROM follows WHERE follower_id = $1 AND target_id = $2',
    [viewerId, company.id],
  );
  const jobs = await query<JobRow>(
    `SELECT ${JOB_COLUMNS} FROM jobs WHERE company_id = $1 ORDER BY posted_at DESC`,
    [company.id],
  );
  const openJobs: Record<string, unknown>[] = [];
  for (const job of jobs) {
    if (jobOpen(job)) openJobs.push(await jobCard(viewerId, job));
  }
  return {
    status: 200,
    body: {
      id: company.id,
      handle: company.handle,
      name: company.name,
      location: company.location,
      about: company.about,
      follower_count: Number(followers[0].count),
      following: following.length > 0,
      is_admin: await isCompanyAdmin(viewerId, company.id),
      open_jobs: openJobs,
    },
  };
}

export async function patchCompany(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const rows = await query<{ id: string }>(
    'SELECT id FROM companies WHERE lower(handle) = lower($1)',
    [ctx.params.handle],
  );
  const company = rows[0];
  if (!company) throw notFound();
  if (!(await isCompanyAdmin(viewerId, company.id))) throw forbidden('not_admin');
  const body = jsonBody(ctx);
  const fields: Record<string, string> = {};
  if (body.name !== undefined && String(body.name).trim() === '') fields.name = 'Enter a name.';
  if (Object.keys(fields).length > 0) throw validation(fields);
  await query(
    `UPDATE companies SET name = coalesce($2, name), location = coalesce($3, location),
     about = coalesce($4, about) WHERE id = $1`,
    [
      company.id,
      body.name === undefined ? null : String(body.name),
      body.location === undefined ? null : String(body.location),
      body.about === undefined ? null : String(body.about),
    ],
  );
  return getCompany(ctx);
}

export async function getFollowers(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const rows = await query<{ id: string }>(
    'SELECT id FROM companies WHERE lower(handle) = lower($1)',
    [ctx.params.handle],
  );
  const company = rows[0];
  if (!company) throw notFound();
  if (!(await isCompanyAdmin(viewerId, company.id))) throw forbidden('not_admin');
  const followerRows = await query<{ follower_id: string }>(
    'SELECT follower_id FROM follows WHERE target_id = $1 ORDER BY created_at DESC',
    [company.id],
  );
  const followers: Record<string, unknown>[] = [];
  for (const row of followerRows) {
    const member = await memberById(row.follower_id);
    if (!member) continue;
    if (await blockExists(viewerId, member.id)) continue;
    followers.push(await personCard(viewerId, member));
  }
  return { status: 200, body: { followers } };
}

function validateJobValues(values: {
  title?: unknown;
  location?: unknown;
  workplace?: unknown;
  description?: unknown;
  closes_at?: unknown;
}): Record<string, string> {
  const fields: Record<string, string> = {};
  if (values.title !== undefined && String(values.title).trim() === '') {
    fields.title = 'Enter a job title.';
  }
  if (values.location !== undefined && String(values.location).trim() === '') {
    fields.location = 'Enter a location.';
  }
  if (
    values.workplace !== undefined &&
    !['on-site', 'hybrid', 'remote'].includes(String(values.workplace))
  ) {
    fields.workplace = 'Choose a workplace.';
  }
  if (values.description !== undefined && String(values.description).trim() === '') {
    fields.description = 'Write a description.';
  }
  if (values.closes_at !== undefined) {
    const closesAt = new Date(String(values.closes_at));
    if (Number.isNaN(closesAt.getTime()) || closesAt.getTime() <= businessNow().getTime()) {
      fields.closes_at = 'Pick a closing time in the future.';
    }
  }
  return fields;
}

export async function createJob(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const body = jsonBody(ctx);
  const companyId = String(body.company_id ?? '');
  const company = await query<{ id: string }>('SELECT id FROM companies WHERE id = $1', [companyId]);
  if (company.length === 0) throw notFound();
  if (!(await isCompanyAdmin(viewerId, companyId))) throw forbidden('not_admin');
  const fields = validateJobValues({
    title: body.title ?? '',
    location: body.location ?? '',
    workplace: body.workplace ?? '',
    description: body.description ?? '',
    closes_at: body.closes_at ?? '',
  });
  if (Object.keys(fields).length > 0) throw validation(fields);
  const id = newId('job');
  await query(
    `INSERT INTO jobs (id, company_id, poster_id, title, location, workplace, description, posted_at, closes_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      id,
      companyId,
      viewerId,
      String(body.title),
      String(body.location),
      String(body.workplace),
      String(body.description),
      businessNow(),
      new Date(String(body.closes_at)),
    ],
  );
  const job = await jobById(id);
  if (!job) throw notFound();
  return { status: 201, body: await jobCard(viewerId, job) };
}

export async function getJob(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const job = await jobById(ctx.params.id);
  if (!job) throw notFound();
  const admin = await isCompanyAdmin(viewerId, job.company_id);
  const questions = await questionsOf(job.id);
  const application = await query<ApplicationRow>(
    `SELECT ${APPLICATION_COLUMNS} FROM applications WHERE job_id = $1 AND applicant_id = $2`,
    [job.id, viewerId],
  );
  return {
    status: 200,
    body: {
      ...(await jobCard(viewerId, job)),
      description: job.description,
      questions: questions.map((question) => questionObject(question, admin)),
      stages: hiringStages(),
      my_application: application[0]
        ? {
            id: application[0].id,
            state: application[0].state,
            status_text: STAGE_STATUS_TEXT[application[0].state],
          }
        : null,
    },
  };
}

async function requireJobAdmin(viewerId: string, jobId: string): Promise<JobRow> {
  const job = await jobById(jobId);
  if (!job) throw notFound();
  if (!(await isCompanyAdmin(viewerId, job.company_id))) throw notFound();
  return job;
}

export async function getJobEditor(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const job = await requireJobAdmin(viewerId, ctx.params.id);
  const member = await memberById(viewerId);
  const joined = member !== null && markJobEditor(job.id, viewerId, member.name);
  const questions = await questionsOf(job.id);
  const field = (name: JobField, value: unknown): Record<string, unknown> => ({
    value,
    version: job.versions[name] ?? 1,
  });
  if (joined) pushJobPresence(job.id);
  return {
    status: 200,
    body: {
      fields: {
        title: field('title', job.title),
        location: field('location', job.location),
        workplace: field('workplace', job.workplace),
        closes_at: field('closes_at', job.closes_at.toISOString()),
        description: field('description', job.description),
        questions: field(
          'questions',
          questions.map((question) => questionObject(question, true)),
        ),
      },
      editing: jobEditorList(job.id).filter((entry) => entry.id !== viewerId),
    },
  };
}

export async function jobEditorTyping(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const job = await requireJobAdmin(viewerId, ctx.params.id);
  const body = jsonBody(ctx);
  const member = await memberById(viewerId);
  if (member) markJobEditor(job.id, viewerId, member.name);
  pushToAll('job_typing', {
    job_id: job.id,
    field: String(body.field ?? ''),
    member_id: viewerId,
    name: member?.name ?? '',
  });
  return { status: 204, body: null };
}

function validateQuestions(list: unknown): { rows: Record<string, unknown>[]; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const rows = Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
  rows.forEach((raw, index) => {
    const position = index + 1;
    const type = String(raw.type ?? '');
    const text = String(raw.text ?? '');
    const knockOut = raw.knock_out === true;
    if (text.trim() === '' || [...text].length > 200) {
      errors[`questions.${position}.text`] = 'Write the question in 1 to 200 characters.';
    }
    if (type === 'single_choice') {
      const options = Array.isArray(raw.options) ? raw.options.map((o) => String(o)) : [];
      if (options.length < 2) errors[`questions.${position}.options`] = 'Add at least two options.';
      else {
        const lowered = options.map((option) => option.toLowerCase());
        if (new Set(lowered).size !== lowered.length) {
          errors[`questions.${position}.options`] = 'Options must differ.';
        }
      }
      const accepted = Array.isArray(raw.accepted) ? raw.accepted.map((o) => String(o)) : [];
      if (knockOut && accepted.length === 0) {
        errors[`questions.${position}.accepted`] = 'Accept at least one option.';
      }
    }
    if (type === 'yes_no' && knockOut && raw.ideal !== 'yes' && raw.ideal !== 'no') {
      errors[`questions.${position}.ideal`] = 'Pick the ideal answer.';
    }
    if (type === 'number') {
      const minimum = raw.minimum === null || raw.minimum === undefined ? null : Number(raw.minimum);
      const maximum = raw.maximum === null || raw.maximum === undefined ? null : Number(raw.maximum);
      if (knockOut && minimum === null && maximum === null) {
        errors[`questions.${position}.minimum`] = 'Set a minimum or a maximum.';
      }
      if (minimum !== null && maximum !== null && minimum > maximum) {
        errors[`questions.${position}.minimum`] = 'Minimum must not exceed maximum.';
      }
    }
  });
  return { rows, errors };
}

export async function patchJobField(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const field = ctx.params.field as JobField;
  if (!FIELDS.includes(field)) throw notFound();
  const job = await requireJobAdmin(viewerId, ctx.params.id);
  const body = jsonBody(ctx);
  const sentVersion = Number(body.version);
  const currentVersion = job.versions[field] ?? 1;

  const currentValue = async (): Promise<unknown> => {
    if (field === 'questions') {
      return (await questionsOf(job.id)).map((question) => questionObject(question, true));
    }
    if (field === 'closes_at') return job.closes_at.toISOString();
    return job[field];
  };

  if (!Number.isFinite(sentVersion) || sentVersion !== currentVersion) {
    throw conflict('field_conflict', {
      field,
      current_version: currentVersion,
      current: await currentValue(),
      by: job.field_editors[field] ?? null,
    });
  }

  if (field === 'questions') {
    const applications = await query<{ one: number }>(
      'SELECT 1 AS one FROM applications WHERE job_id = $1 LIMIT 1',
      [job.id],
    );
    if (applications.length > 0) throw conflict('questions_locked');
    const list = Array.isArray(body.value) ? body.value : [];
    if (list.length > MAX_QUESTIONS) {
      throw namedValidation('too_many_questions', { limit: MAX_QUESTIONS });
    }
    const { rows, errors } = validateQuestions(list);
    if (Object.keys(errors).length > 0) throw validation(errors);
    await transact(async (client) => {
      const keep: string[] = [];
      for (const [index, raw] of rows.entries()) {
        const id = raw.id ? String(raw.id) : newId('qst');
        keep.push(id);
        const options = Array.isArray(raw.options) ? raw.options.map((o) => String(o)) : null;
        const accepted = Array.isArray(raw.accepted) ? raw.accepted.map((o) => String(o)) : null;
        await client.query(
          `INSERT INTO job_questions (id, job_id, position, type, text, required, knock_out, ideal, options, accepted, minimum, maximum)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (id) DO UPDATE SET position = EXCLUDED.position, type = EXCLUDED.type,
             text = EXCLUDED.text, required = EXCLUDED.required, knock_out = EXCLUDED.knock_out,
             ideal = EXCLUDED.ideal, options = EXCLUDED.options, accepted = EXCLUDED.accepted,
             minimum = EXCLUDED.minimum, maximum = EXCLUDED.maximum`,
          [
            id,
            job.id,
            index + 1,
            String(raw.type ?? ''),
            String(raw.text ?? ''),
            raw.required === true,
            raw.knock_out === true,
            raw.ideal === 'yes' || raw.ideal === 'no' ? String(raw.ideal) : null,
            options ? JSON.stringify(options) : null,
            accepted ? JSON.stringify(accepted) : null,
            raw.minimum === null || raw.minimum === undefined ? null : Number(raw.minimum),
            raw.maximum === null || raw.maximum === undefined ? null : Number(raw.maximum),
          ],
        );
      }
      await client.query(
        keep.length > 0
          ? 'DELETE FROM job_questions WHERE job_id = $1 AND NOT (id = ANY($2))'
          : 'DELETE FROM job_questions WHERE job_id = $1',
        keep.length > 0 ? [job.id, keep] : [job.id],
      );
    });
  } else {
    const fields = validateJobValues({ [field]: body.value });
    if (Object.keys(fields).length > 0) throw validation(fields);
    const value = field === 'closes_at' ? new Date(String(body.value)) : String(body.value);
    await query(`UPDATE jobs SET ${field} = $2 WHERE id = $1`, [job.id, value]);
  }

  const member = await memberById(viewerId);
  const nextVersion = currentVersion + 1;
  await query(
    `UPDATE jobs SET versions = jsonb_set(versions, $2, $3::jsonb),
     field_editors = jsonb_set(field_editors, $2, $4::jsonb) WHERE id = $1`,
    [
      job.id,
      `{${field}}`,
      String(nextVersion),
      JSON.stringify({ id: viewerId, name: member?.name ?? '' }),
    ],
  );
  const updated = await jobById(job.id);
  if (!updated) throw notFound();
  const value =
    field === 'questions'
      ? (await questionsOf(job.id)).map((question) => questionObject(question, true))
      : field === 'closes_at'
        ? updated.closes_at.toISOString()
        : updated[field];
  pushToAll('job_field', {
    job_id: job.id,
    field,
    value,
    version: nextVersion,
    by: { id: viewerId, name: member?.name ?? '' },
    label: FIELD_LABELS[field],
  });
  return { status: 200, body: { field, value, version: nextVersion } };
}

export async function getFunnel(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const job = await jobById(ctx.params.id);
  if (!job) throw notFound();
  if (job.poster_id !== viewerId) throw forbidden('not_poster');
  const funnel = await funnelFor(job.id);
  return {
    status: 200,
    body: {
      rows: funnel.rows,
      median_first_view_minutes: funnel.median_first_view_minutes,
      automatic: funnel.automatic,
    },
  };
}

export async function saveJob(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const job = await jobById(ctx.params.id);
  if (!job) throw notFound();
  await query(
    `INSERT INTO saved_jobs (member_id, job_id, saved_at) VALUES ($1,$2,$3)
     ON CONFLICT (member_id, job_id) DO NOTHING`,
    [viewerId, job.id, businessNow()],
  );
  return { status: 200, body: { saved: true } };
}

export async function unsaveJob(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const job = await jobById(ctx.params.id);
  if (!job) throw notFound();
  await query('DELETE FROM saved_jobs WHERE member_id = $1 AND job_id = $2', [viewerId, job.id]);
  return { status: 200, body: { saved: false } };
}

export async function myJobs(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const tab = ctx.search.get('tab') === 'applied' ? 'applied' : 'saved';
  const jobs: Record<string, unknown>[] = [];
  if (tab === 'saved') {
    const rows = await query<JobRow>(
      `SELECT ${JOB_COLUMNS.split(', ').map((column) => `j.${column}`).join(', ')}
       FROM saved_jobs s JOIN jobs j ON j.id = s.job_id
       WHERE s.member_id = $1 ORDER BY s.saved_at DESC`,
      [viewerId],
    );
    for (const job of rows) jobs.push({ ...(await jobCard(viewerId, job)), my_application: null });
  } else {
    const rows = await query<JobRow & { application_id: string }>(
      `SELECT ${JOB_COLUMNS.split(', ').map((column) => `j.${column}`).join(', ')}, a.id AS application_id
       FROM applications a JOIN jobs j ON j.id = a.job_id
       WHERE a.applicant_id = $1 ORDER BY a.created_at DESC`,
      [viewerId],
    );
    for (const row of rows) {
      const application = await applicationById(row.application_id);
      jobs.push({
        ...(await jobCard(viewerId, row)),
        my_application: application ? await applicationObject(application) : null,
      });
    }
  }
  return { status: 200, body: { jobs } };
}

async function rejectionEmail(application: ApplicationRow): Promise<void> {
  const applicant = await memberById(application.applicant_id);
  const job = await jobById(application.job_id);
  if (!applicant || !job) return;
  await queueMail(
    applicant.email,
    `Update on your application for ${job.title}`,
    `Your application for ${job.title} is now: ${STAGE_STATUS_TEXT.rejected}.`,
  );
}

async function announceStatus(application: ApplicationRow): Promise<void> {
  const job = await jobById(application.job_id);
  if (!job) return;
  const text = `Your application for ${job.title} is now: ${STAGE_STATUS_TEXT[application.state]}.`;
  await notify({
    memberId: application.applicant_id,
    actorId: null,
    kind: 'application_status',
    subjectId: application.id,
    targetUrl: '/my-jobs',
    detail: text,
  });
  pushTo([application.applicant_id, job.poster_id], 'application', {
    application_id: application.id,
    job_id: job.id,
    state: application.state,
    status_text: STAGE_STATUS_TEXT[application.state],
    job_title: job.title,
  });
}

export async function createApplication(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const jobId = ctx.params.id;
  return withIdempotency(ctx, viewerId, 'POST /api/jobs/:id/applications', async () => {
    const job = await jobById(jobId);
    if (!job) throw notFound();
    const existing = await query<{ id: string }>(
      'SELECT id FROM applications WHERE job_id = $1 AND applicant_id = $2',
      [job.id, viewerId],
    );
    if (existing[0]) throw conflict('already_applied', { application_id: existing[0].id });
    if (!jobOpen(job)) throw conflict('job_closed');

    const body = jsonBody(ctx);
    const resumeId = String(body.resume_id ?? '');
    const resume = await query<{ id: string }>(
      'SELECT id FROM resume_uploads WHERE id = $1 AND member_id = $2',
      [resumeId, viewerId],
    );
    if (resume.length === 0) throw notFound();

    const answers = (body.answers ?? {}) as Record<string, unknown>;
    const questions = await questionsOf(job.id);
    const errors = checkAnswers(questions, answers);
    if (Object.keys(errors).length > 0) throw validation(errors);

    const id = newId('app');
    const now = businessNow();
    await query(
      `INSERT INTO applications (id, job_id, applicant_id, state, created_at, entered_at, resume_id, answers)
       VALUES ($1,$2,$3,'applied',$4,$4,$5,$6)`,
      [id, job.id, viewerId, now, resumeId, JSON.stringify(answers)],
    );
    await addHistory(id, 'applied', 'you', null);

    const miss = firstKnockOutMiss(questions, answers);
    if (miss) {
      await query(`UPDATE applications SET state = 'rejected', entered_at = $2 WHERE id = $1`, [
        id,
        businessNow(),
      ]);
      await addHistory(id, 'rejected', 'automatic', miss.text);
    }
    const application = await applicationById(id);
    if (!application) throw notFound();
    if (miss) await rejectionEmail(application);
    await announceStatus(application);
    pushTo([job.poster_id], 'board', { job_id: job.id });
    return { status: 201, body: await applicationObject(application) };
  });
}

async function boardCard(application: ApplicationRow): Promise<Record<string, unknown>> {
  const applicant = await memberById(application.applicant_id);
  return {
    id: application.id,
    applicant: {
      id: applicant?.id ?? application.applicant_id,
      name: applicant?.name ?? '',
      handle: applicant?.handle ?? '',
      headline: applicant?.headline ?? '',
    },
    state: application.state,
    entered_at: application.entered_at.toISOString(),
  };
}

export async function getBoard(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const job = await jobById(ctx.params.id);
  if (!job) throw notFound();
  if (job.poster_id !== viewerId) throw forbidden('not_poster');
  const rows = await query<ApplicationRow>(
    `SELECT ${APPLICATION_COLUMNS} FROM applications WHERE job_id = $1 ORDER BY entered_at, id`,
    [job.id],
  );
  const columns: Record<string, Record<string, unknown>[]> = {
    applied: [],
    viewed: [],
    interviewing: [],
    offered: [],
    rejected: [],
    withdrawn: [],
  };
  for (const application of rows) columns[application.state].push(await boardCard(application));
  return { status: 200, body: { columns } };
}

/** Only the applicant and the job's poster may see an application. */
async function requireApplicationAccess(
  viewerId: string,
  applicationId: string,
): Promise<{ application: ApplicationRow; job: JobRow; isPoster: boolean }> {
  const application = await applicationById(applicationId);
  if (!application) throw notFound();
  const job = await jobById(application.job_id);
  if (!job) throw notFound();
  const isPoster = job.poster_id === viewerId;
  if (!isPoster && application.applicant_id !== viewerId) throw notFound();
  return { application, job, isPoster };
}

export async function getApplication(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  let { application, job, isPoster } = await requireApplicationAccess(viewerId, ctx.params.id);

  /* The poster opening an application moves it from applied to viewed, once. */
  if (isPoster && application.state === 'applied') {
    await query(`UPDATE applications SET state = 'viewed', entered_at = $2 WHERE id = $1`, [
      application.id,
      businessNow(),
    ]);
    await addHistory(application.id, 'viewed', 'hiring_team', null);
    const reloaded = await applicationById(application.id);
    if (reloaded) {
      application = reloaded;
      await announceStatus(application);
      pushTo([job.poster_id], 'board', { job_id: job.id });
    }
  }

  const extras: { applicant?: Record<string, unknown>; resumeUrl?: string | null } = {};
  if (isPoster) {
    const applicant = await memberById(application.applicant_id);
    extras.applicant = applicant ? await personCard(viewerId, applicant) : undefined;
    extras.resumeUrl = `/api/applications/${application.id}/resume`;
  }
  return { status: 200, body: await applicationObject(application, extras) };
}

export async function transitionApplication(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const { application, job, isPoster } = await requireApplicationAccess(viewerId, ctx.params.id);
  const body = jsonBody(ctx);
  const to = String(body.to ?? '') as ApplicationState;

  if (!isPoster && to !== 'withdrawn') throw forbidden('not_poster');
  if (isPoster && to === 'withdrawn') throw forbidden('not_applicant');
  if (!isLegalTransition(application.state, to)) {
    throw conflict('invalid_transition', { from: application.state, to });
  }

  await transact(async (client) => {
    const locked = await client.query<{ state: ApplicationState }>(
      'SELECT state FROM applications WHERE id = $1 FOR UPDATE',
      [application.id],
    );
    const current = locked.rows[0].state;
    if (!isLegalTransition(current, to)) {
      throw conflict('invalid_transition', { from: current, to });
    }
    await client.query('UPDATE applications SET state = $2, entered_at = $3 WHERE id = $1', [
      application.id,
      to,
      businessNow(),
    ]);
  });
  await addHistory(application.id, to, isPoster ? 'hiring_team' : 'you', null);
  const updated = await applicationById(application.id);
  if (!updated) throw notFound();
  if (to === 'rejected') await rejectionEmail(updated);
  await announceStatus(updated);
  pushTo([job.poster_id], 'board', { job_id: job.id });

  const extras: { applicant?: Record<string, unknown>; resumeUrl?: string | null } = {};
  if (isPoster) {
    const applicant = await memberById(updated.applicant_id);
    extras.applicant = applicant ? await personCard(viewerId, applicant) : undefined;
    extras.resumeUrl = `/api/applications/${updated.id}/resume`;
  }
  return { status: 200, body: await applicationObject(updated, extras) };
}

export async function getResume(ctx: Ctx): Promise<void> {
  const viewerId = requireMember(ctx);
  const { application } = await requireApplicationAccess(viewerId, ctx.params.id);
  if (!application.resume_id) throw notFound();
  const key = `resumes/${application.applicant_id}/${application.resume_id}.pdf`;
  let bytes: Buffer;
  try {
    bytes = await getObject(key);
  } catch {
    throw storageUnavailable();
  }
  ctx.res.writeHead(200, {
    'content-type': 'application/pdf',
    'content-length': String(bytes.length),
    'content-disposition': 'inline; filename="resume.pdf"',
  });
  ctx.res.end(bytes);
}
