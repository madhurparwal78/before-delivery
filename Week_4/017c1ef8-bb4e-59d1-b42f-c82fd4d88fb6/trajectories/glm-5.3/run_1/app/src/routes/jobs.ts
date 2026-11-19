import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { config } from '../config.js';
import { businessMs } from '../clock.js';
import { errors, newId, conflict, ApiError } from '../errors.js';
import { wrap, requireSession } from '../http.js';
import { withIdempotency } from '../idempotency.js';
import { pushTo } from '../live.js';
import { sendMail } from '../mail.js';
import { getMemberById } from '../profile.js';
import {
  STAGES, statusText, isLegalMove, validateQuestions, checkAnswers,
  firstMissedKnockOut, jobOpen, funnelFor, QuestionInput,
} from '../domain/jobs.js';
import { putObject, getObject } from '../s3.js';
import Busboy from 'busboy';
import { createHash } from 'node:crypto';

const WORKPLACES = ['on-site', 'hybrid', 'remote'];

export type JobCardRow = {
  id: string; title: string; company_id: string; company_name: string; company_handle: string;
  location: string; workplace: string; posted_at: Date; closes_at: Date;
};

export const jobCardForViewer = async (viewerId: string, job: JobCardRow): Promise<Record<string, unknown>> => {
  const saved = await query(`SELECT 1 FROM saved_jobs WHERE member_id = $1 AND job_id = $2`, [viewerId, job.id]);
  const applied = await query(`SELECT 1 FROM applications WHERE job_id = $1 AND applicant_id = $2`, [job.id, viewerId]);
  return {
    id: job.id, title: job.title,
    company: { id: job.company_id, name: job.company_name, handle: job.company_handle },
    location: job.location, workplace: job.workplace,
    posted_at: job.posted_at.toISOString(), closes_at: job.closes_at.toISOString(),
    open: jobOpen(job.closes_at),
    saved: saved.rows.length > 0,
    applied: applied.rows.length > 0,
  };
};

export type JobRow = {
  id: string; company_id: string; poster_id: string; title: string; location: string;
  workplace: string; posted_at: Date; closes_at: Date; description: string;
  title_version: number; location_version: number; workplace_version: number;
  closes_at_version: number; description_version: number; questions_version: number;
};

const loadJob = async (id: string): Promise<JobRow | undefined> => {
  const result = await query<JobRow>(
    `SELECT id, company_id, poster_id, title, location, workplace, posted_at, closes_at, description,
            title_version, location_version, workplace_version, closes_at_version, description_version, questions_version
     FROM jobs WHERE id = $1`, [id]);
  return result.rows[0];
};

const isAdminOf = async (memberId: string, companyId: string): Promise<boolean> => {
  const result = await query(`SELECT 1 FROM company_admins WHERE company_id = $1 AND member_id = $2`, [companyId, memberId]);
  return result.rows.length > 0;
};

const questionRows = async (jobId: string): Promise<{
  id: string; type: string; text: string; required: boolean; knock_out: boolean;
  ideal: string | null; options: string[] | null; accepted: string[] | null;
  minimum: number | null; maximum: number | null; position: number;
}[]> => {
  const result = await query(
    `SELECT id, type, text, required, knock_out, ideal, options, accepted, minimum, maximum, position
     FROM screening_questions WHERE job_id = $1 ORDER BY position`, [jobId]);
  return result.rows.map((row) => ({
    id: row.id, type: row.type, text: row.text, required: row.required, knock_out: row.knock_out,
    ideal: row.ideal, options: row.options ?? null, accepted: row.accepted ?? null,
    minimum: row.minimum === null ? null : Number(row.minimum),
    maximum: row.maximum === null ? null : Number(row.maximum),
    position: row.position,
  }));
};

export type ApplicationRow = {
  id: string; job_id: string; applicant_id: string; resume_id: string | null;
  state: string; created_at: Date;
};

const applicationById = async (id: string): Promise<ApplicationRow | undefined> => {
  const result = await query<ApplicationRow>(
    `SELECT id, job_id, applicant_id, resume_id, state, created_at FROM applications WHERE id = $1`, [id]);
  return result.rows[0];
};

export type HistoryRow = { state: string; at: Date; by: string; reason: string | null };

const historyFor = async (applicationId: string): Promise<HistoryRow[]> => {
  const result = await query<HistoryRow>(
    `SELECT state, at, by, reason FROM application_history WHERE application_id = $1 ORDER BY at ASC`, [applicationId]);
  return result.rows;
};

const applicationObject = async (application: NonNullable<Awaited<ReturnType<typeof applicationById>>>, viewerId: string): Promise<Record<string, unknown>> => {
  const job = await loadJob(application.job_id);
  if (!job) throw errors.notFound();
  const company = await query(`SELECT id, name, handle FROM companies WHERE id = $1`, [job.company_id]);
  const history = await historyFor(application.id);
  const base: Record<string, unknown> = {
    id: application.id,
    job: { id: job.id, title: job.title, company: { id: company.rows[0]?.id, name: company.rows[0]?.name } },
    state: application.state,
    status_text: statusText(application.state),
    history: history.map((h) => ({
      state: h.state, status_text: statusText(h.state), at: h.at.toISOString(),
      by: h.by === 'you' ? 'you' : h.by === 'hiring_team' ? 'hiring_team' : 'automatic',
      reason: h.reason,
    })),
  };
  if (viewerId === job.poster_id) {
    const applicant = await getMemberById(application.applicant_id);
    base.applicant = applicant ? {
      id: applicant.id, handle: applicant.handle, name: applicant.name, headline: applicant.headline,
      photo_url: applicant.photo_id ? `/media/photos/${applicant.photo_id}` : null,
      degree: '', connection_state: '', mutual_count: 0,
    } : null;
    base.resume_url = application.resume_id ? `/api/applications/${application.id}/resume` : null;
  }
  return base;
};

const notifyApplicant = async (applicantId: string, jobId: string, applicationId: string, state: string): Promise<void> => {
  const existing = await query(`SELECT id FROM notifications WHERE member_id = $1 AND kind = 'application_status' AND application_id = $2 AND actor_id IS NULL`,
    [applicantId, applicationId]);
  void state;
  if (existing.rows.length === 0) {
    await query(
      `INSERT INTO notifications (id, member_id, kind, job_id, application_id, count, created_at, updated_at)
       VALUES ($1, $2, 'application_status', $3, $4, 1, $5, $5)`,
      [newId(), applicantId, jobId, applicationId, new Date(businessMs())]);
  } else {
    await query(`UPDATE notifications SET updated_at = $1 WHERE id = $2`, [new Date(businessMs()), existing.rows[0].id]);
  }
  pushTo(applicantId, 'notification', { kind: 'application_status' });
};

export const jobsRouter = (): Router => {
  const router = Router();
  router.use('/jobs', requireSession);
  router.use('/companies', requireSession);
  router.use('/applications', requireSession);
  router.use('/uploads/resume', requireSession);

  // --- Companies ---

  router.get('/companies/:handle', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const company = await query(`SELECT id, handle, name, location, about FROM companies WHERE lower(handle) = lower($1)`, [req.params.handle]);
    if (company.rows.length === 0) throw errors.notFound();
    const row = company.rows[0];
    const followerCount = await query<{ n: string }>(`SELECT count(*)::text AS n FROM follows WHERE target_id = $1`, [row.id]);
    const following = await query(`SELECT 1 FROM follows WHERE follower_id = $1 AND target_id = $2`, [viewerId, row.id]);
    const isAdmin = await isAdminOf(viewerId, row.id);
    const jobs = await query<JobCardRow>(
      `SELECT j.id, j.title, j.company_id, c.name AS company_name, c.handle AS company_handle,
              j.location, j.workplace, j.posted_at, j.closes_at
       FROM jobs j JOIN companies c ON c.id = j.company_id
       WHERE j.company_id = $1 ORDER BY j.posted_at DESC`, [row.id]);
    const openJobs = [];
    for (const job of jobs.rows) {
      if (!jobOpen(job.closes_at)) continue;
      openJobs.push(await jobCardForViewer(viewerId, job));
    }
    res.json({
      id: row.id, handle: row.handle, name: row.name, location: row.location, about: row.about,
      follower_count: Number(followerCount.rows[0].n),
      following: following.rows.length > 0,
      is_admin: isAdmin,
      open_jobs: openJobs,
    });
  }));

  router.patch('/companies/:handle', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const company = await query(`SELECT id FROM companies WHERE lower(handle) = lower($1)`, [req.params.handle]);
    if (company.rows.length === 0) throw errors.notFound();
    if (!(await isAdminOf(viewerId, company.rows[0].id))) throw errors.notAdmin();
    const { name, location, about } = (req.body ?? {}) as Record<string, string | undefined>;
    await query(`UPDATE companies SET name = COALESCE($1, name), location = COALESCE($2, location), about = COALESCE($3, about) WHERE id = $4`,
      [name ?? null, location ?? null, about ?? null, company.rows[0].id]);
    const fresh = await query(`SELECT id, handle, name, location, about FROM companies WHERE id = $1`, [company.rows[0].id]);
    res.json(fresh.rows[0]);
  }));

  router.get('/companies/:handle/followers', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const company = await query(`SELECT id FROM companies WHERE lower(handle) = lower($1)`, [req.params.handle]);
    if (company.rows.length === 0) throw errors.notFound();
    if (!(await isAdminOf(viewerId, company.rows[0].id))) throw errors.notAdmin();
    const result = await query<{ follower_id: string }>(
      `SELECT follower_id FROM follows WHERE target_id = $1 ORDER BY at DESC`, [company.rows[0].id]);
    const followers = [];
    for (const row of result.rows) {
      const member = await getMemberById(row.follower_id);
      if (!member) continue;
      followers.push({
        id: member.id, handle: member.handle, name: member.name, headline: member.headline,
        photo_url: member.photo_id ? `/media/photos/${member.photo_id}` : null,
      });
    }
    res.json({ followers });
  }));

  // --- Jobs ---

  router.post('/jobs', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const { company_id, title, location, workplace, closes_at, description } = (req.body ?? {}) as Record<string, string>;
    if (!(await isAdminOf(viewerId, company_id))) throw errors.notAdmin();
    const fields: Record<string, string> = {};
    if (!title || title.length < 1) fields.title = 'Enter a title.';
    if (!location) fields.location = 'Enter a location.';
    if (!WORKPLACES.includes(workplace)) fields.workplace = 'Choose a workplace.';
    if (!description) fields.description = 'Enter a description.';
    const closes = Date.parse(closes_at ?? '');
    if (Number.isNaN(closes)) fields.closes_at = 'Pick a closing time.';
    else if (closes <= businessMs()) fields.closes_at = 'Pick a closing time in the future.';
    if (Object.keys(fields).length > 0) throw errors.validation(fields);
    const id = newId();
    await query(
      `INSERT INTO jobs (id, company_id, poster_id, title, location, workplace, posted_at, closes_at, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, company_id, viewerId, title, location, workplace, new Date(businessMs()), new Date(closes), description]);
    const job = await loadJob(id);
    const company = await query<{ name: string; handle: string }>(`SELECT name, handle FROM companies WHERE id = $1`, [company_id]);
    if (!job || !company.rows[0]) throw errors.notFound();
    res.status(201).json(await jobCardForViewer(viewerId, {
      id: job.id, title: job.title, company_id: job.company_id,
      company_name: company.rows[0].name, company_handle: company.rows[0].handle,
      location: job.location, workplace: job.workplace, posted_at: job.posted_at, closes_at: job.closes_at,
    }));
  }));

  router.get('/jobs/:id', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const job = await loadJob(req.params.id);
    if (!job) throw errors.notFound();
    const company = await query(`SELECT id, name, handle FROM companies WHERE id = $1`, [job.company_id]);
    const card = await jobCardForViewer(viewerId, {
      ...job, company_name: company.rows[0]?.name, company_handle: company.rows[0]?.handle,
    });
    const questions = await questionRows(job.id);
    const isAdmin = await isAdminOf(viewerId, job.company_id);
    const myApplication = await query(`SELECT id, state FROM applications WHERE job_id = $1 AND applicant_id = $2`,
      [job.id, viewerId]);
    res.json({
      ...card,
      description: job.description,
      poster_id: job.poster_id,
      stages: STAGES.map((s) => ({ state: s.state, label: s.label, status_text: s.status_text, moved_by: s.moved_by })),
      questions: questions.map((q) => isAdmin
        ? { id: q.id, type: q.type, text: q.text, required: q.required, knock_out: q.knock_out, ideal: q.ideal, options: q.options, accepted: q.accepted, minimum: q.minimum, maximum: q.maximum }
        : { id: q.id, type: q.type, text: q.text, required: q.required, options: q.options }),
      my_application: myApplication.rows[0]
        ? { id: myApplication.rows[0].id, state: myApplication.rows[0].state, status_text: statusText(myApplication.rows[0].state) }
        : null,
    });
  }));

  router.get('/jobs/:id/editor', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const job = await loadJob(req.params.id);
    if (!job) throw errors.notFound();
    if (!(await isAdminOf(viewerId, job.company_id))) throw errors.notFound();
    const questions = await questionRows(job.id);
    const editing = await query<{ member_id: string; name: string; opened_at: Date }>(
      `SELECT e.member_id, m.name, e.opened_at FROM editor_presence e JOIN members m ON m.id = e.member_id
       WHERE e.job_id = $1 AND e.member_id <> $2 AND e.last_seen > $3::timestamptz - interval '5 seconds'
       ORDER BY e.opened_at ASC`, [job.id, viewerId, sqlNow()]);
    res.json({
      fields: {
        title: { value: job.title, version: job.title_version },
        location: { value: job.location, version: job.location_version },
        workplace: { value: job.workplace, version: job.workplace_version },
        closes_at: { value: job.closes_at.toISOString(), version: job.closes_at_version },
        description: { value: job.description, version: job.description_version },
        questions: {
          value: questions.map((q) => ({
            id: q.id, type: q.type, text: q.text, required: q.required, knock_out: q.knock_out,
            ideal: q.ideal, options: q.options, accepted: q.accepted, minimum: q.minimum, maximum: q.maximum,
          })),
          version: job.questions_version,
        },
      },
      editing: editing.rows.map((e) => ({ id: e.member_id, name: e.name })),
    });
  }));

  router.post('/jobs/:id/editor/presence', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const job = await loadJob(req.params.id);
    if (!job) throw errors.notFound();
    if (!(await isAdminOf(viewerId, job.company_id))) throw errors.notFound();
    await query(
      `INSERT INTO editor_presence (job_id, member_id, opened_at, last_seen) VALUES ($1, $2, $3, $3)
       ON CONFLICT (job_id, member_id) DO UPDATE SET last_seen = $3`,
      [job.id, viewerId, new Date(businessMs())]);
    const others = await query<{ member_id: string }>(
      `SELECT member_id FROM editor_presence WHERE job_id = $1 AND member_id <> $2`, [job.id, viewerId]);
    for (const row of others.rows) {
      pushTo(row.member_id, 'editor_presence', { job_id: job.id, member_id: viewerId });
    }
    res.status(204).end();
  }));

  router.post('/jobs/:id/editor/typing', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const job = await loadJob(req.params.id);
    if (!job) throw errors.notFound();
    if (!(await isAdminOf(viewerId, job.company_id))) throw errors.notFound();
    const { field } = (req.body ?? {}) as { field?: string };
    await query(
      `INSERT INTO typing_signals (kind, scope, member_id, field, at) VALUES ('job', $1, $2, $3, $4)
       ON CONFLICT (kind, scope, member_id, field) DO UPDATE SET at = $4`,
      [job.id, viewerId, field ?? '', new Date(businessMs())]);
    const others = await query<{ member_id: string }>(
      `SELECT member_id FROM editor_presence WHERE job_id = $1 AND member_id <> $2`, [job.id, viewerId]);
    for (const row of others.rows) {
      pushTo(row.member_id, 'editor_typing', { job_id: job.id, member_id: viewerId, field: field ?? '' });
    }
    res.status(204).end();
  }));

  router.patch('/jobs/:id/fields/:field', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const job = await loadJob(req.params.id);
    if (!job) throw errors.notFound();
    if (!(await isAdminOf(viewerId, job.company_id))) throw errors.notFound();
    const field = req.params.field;
    const { value, version } = (req.body ?? {}) as { value?: unknown; version?: number };
    const column = field === 'closes_at' ? 'closes_at' : field;
    const versionColumn = `${column}_version`;
    if (!(versionColumn in job)) throw errors.notFound();
    const currentVersion = Number(job[versionColumn as keyof typeof job]);

    const validate = (v: unknown): void => {
      const fields: Record<string, string> = {};
      if (field === 'title' && (typeof v !== 'string' || v.length < 1)) fields[field] = 'Enter a title.';
      if (field === 'location' && (typeof v !== 'string' || v.length < 1)) fields[field] = 'Enter a location.';
      if (field === 'workplace' && (typeof v !== 'string' || !WORKPLACES.includes(v))) fields[field] = 'Choose a workplace.';
      if (field === 'description' && (typeof v !== 'string' || v.length < 1)) fields[field] = 'Enter a description.';
      if (field === 'closes_at') {
        const t = Date.parse(String(v));
        if (Number.isNaN(t) || t <= businessMs()) fields[field] = 'Pick a closing time in the future.';
      }
      if (Object.keys(fields).length > 0) throw errors.validation(fields);
    };

    if (field === 'questions') {
      const list = Array.isArray(value) ? value as QuestionInput[] : [];
      if (list.length > 10) throw new ApiError(422, { error: 'too_many_questions', limit: 10 });
      const questionFields = validateQuestions(list);
      if (Object.keys(questionFields).length > 0) throw errors.validation(questionFields);
      const applications = await query(`SELECT 1 FROM applications WHERE job_id = $1 LIMIT 1`, [job.id]);
      if (applications.rows.length > 0) throw conflict({ error: 'questions_locked' });
      if (version !== currentVersion) {
        const by = await query<{ id: string; name: string }>(
          `SELECT e.member_id AS id, m.name FROM editor_presence e JOIN members m ON m.id = e.member_id
           WHERE e.job_id = $1 ORDER BY e.last_seen DESC LIMIT 1`, [job.id]);
        throw conflict({
          error: 'field_conflict', field, current_version: currentVersion,
          current: (await questionRows(job.id)).map((q) => ({
            id: q.id, type: q.type, text: q.text, required: q.required, knock_out: q.knock_out,
            ideal: q.ideal, options: q.options, accepted: q.accepted, minimum: q.minimum, maximum: q.maximum,
          })),
          by: by.rows[0] ? { id: by.rows[0].id, name: by.rows[0].name } : { id: viewerId, name: 'You' },
        });
      }
      await withTransaction(async (client) => {
        const keptIds = list.filter((q) => q.id).map((q) => q.id) as string[];
        await client.query(`DELETE FROM screening_questions WHERE job_id = $1 AND id <> ALL($2::text[])`,
          [job.id, keptIds.length > 0 ? keptIds : ['']]);
        let position = 0;
        for (const question of list) {
          if (question.id) {
            await client.query(
              `UPDATE screening_questions SET type = $1, text = $2, required = $3, knock_out = $4,
               ideal = $5, options = $6::jsonb, accepted = $7::jsonb, minimum = $8, maximum = $9, position = $10
               WHERE id = $11 AND job_id = $12`,
              [question.type, question.text, question.required, question.knock_out,
               question.ideal ?? null, JSON.stringify(question.options ?? null),
               JSON.stringify(question.accepted ?? null), question.minimum ?? null, question.maximum ?? null,
               position++, question.id, job.id]);
          } else {
            await client.query(
              `INSERT INTO screening_questions (id, job_id, type, text, required, knock_out, ideal, options, accepted, minimum, maximum, position)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12)`,
              [newId(), job.id, question.type, question.text, question.required, question.knock_out,
               question.ideal ?? null, JSON.stringify(question.options ?? null),
               JSON.stringify(question.accepted ?? null), question.minimum ?? null, question.maximum ?? null,
               position++]);
          }
        }
        await client.query(`UPDATE jobs SET questions_version = questions_version + 1 WHERE id = $1`, [job.id]);
      });
      const fresh = await questionRows(job.id);
      res.json({
        field, version: currentVersion + 1,
        value: fresh.map((q) => ({
          id: q.id, type: q.type, text: q.text, required: q.required, knock_out: q.knock_out,
          ideal: q.ideal, options: q.options, accepted: q.accepted, minimum: q.minimum, maximum: q.maximum,
        })),
      });
      notifyAdmins(job.id, viewerId);
      return;
    }

    validate(value);
    if (version !== currentVersion) {
      const by = await query<{ id: string; name: string }>(
        `SELECT e.member_id AS id, m.name FROM editor_presence e JOIN members m ON m.id = e.member_id
         WHERE e.job_id = $1 ORDER BY e.last_seen DESC LIMIT 1`, [job.id]);
      throw conflict({
        error: 'field_conflict', field, current_version: currentVersion,
        current: job[column as keyof typeof job],
        by: by.rows[0] ? { id: by.rows[0].id, name: by.rows[0].name } : { id: viewerId, name: 'You' },
      });
    }
    const columnMap: Record<string, string> = {
      title: 'title', location: 'location', workplace: 'workplace',
      closes_at: 'closes_at', description: 'description',
    };
    await query(`UPDATE jobs SET ${columnMap[field]} = $1, ${columnMap[field]}_version = ${columnMap[field]}_version + 1 WHERE id = $2`,
      [field === 'closes_at' ? new Date(Date.parse(String(value))) : value, job.id]);
    notifyAdmins(job.id, viewerId);
    res.json({ field, value, version: currentVersion + 1 });
  }));

  router.get('/jobs/:id/funnel', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const job = await loadJob(req.params.id);
    if (!job) throw errors.notFound();
    if (viewerId !== job.poster_id) throw errors.notPoster();
    const applications = await query<{ id: string; state: string; created_at: Date }>(
      `SELECT id, state, created_at FROM applications WHERE job_id = $1`, [job.id]);
    const withHistory = [];
    for (const application of applications.rows) {
      withHistory.push({ ...application, history: await historyFor(application.id) });
    }
    const funnel = funnelFor(withHistory);
    res.json({
      rows: funnel.rows.map((row) => ({
        stage: row.stage, count: row.count, rate: row.rate === null ? null : Number(row.rate.replace('%', '')),
      })),
      median_first_view_minutes: funnel.median_first_view_minutes,
    });
  }));

  router.put('/jobs/:id/save', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const job = await loadJob(req.params.id);
    if (!job) throw errors.notFound();
    await query(`INSERT INTO saved_jobs (member_id, job_id, at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [viewerId, job.id, new Date(businessMs())]);
    res.json({ saved: true });
  }));

  router.delete('/jobs/:id/save', wrap(async (req, res) => {
    await query(`DELETE FROM saved_jobs WHERE member_id = $1 AND job_id = $2`, [req.auth!.memberId, req.params.id]);
    res.json({ saved: false });
  }));

  router.post('/jobs/:id/applications', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    await withIdempotency(req, res, '/api/applications', async () => {
      const job = await loadJob(req.params.id);
      if (!job) throw errors.notFound();
      const { resume_id, answers } = (req.body ?? {}) as { resume_id?: string; answers?: Record<string, unknown> };
      const resume = await query(`SELECT 1 FROM uploads WHERE id = $1 AND owner_id = $2 AND kind = 'resume'`,
        [resume_id ?? '', viewerId]);
      if (!resume_id || resume.rows.length === 0) throw errors.notFound();
      const existing = await query(`SELECT id FROM applications WHERE job_id = $1 AND applicant_id = $2`, [job.id, viewerId]);
      if (existing.rows.length > 0) {
        throw conflict({ error: 'already_applied', application_id: existing.rows[0].id });
      }
      if (!jobOpen(job.closes_at)) throw conflict({ error: 'job_closed' });

      const questions = await questionRows(job.id);
      const answerMap = answers ?? {};
      const { fields } = checkAnswers(questions, answerMap);
      if (Object.keys(fields).length > 0) throw errors.validation(fields);

      const applicationId = newId();
      const now = new Date(businessMs());
      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO applications (id, job_id, applicant_id, resume_id, state, created_at)
           VALUES ($1, $2, $3, $4, 'applied', $5)`,
          [applicationId, job.id, viewerId, resume_id, now]);
        await client.query(
          `INSERT INTO application_history (id, application_id, state, at, by, reason)
           VALUES ($1, $2, 'applied', $3, 'you', NULL)`,
          [newId(), applicationId, now]);
        for (const [questionId, answer] of Object.entries(answerMap)) {
          await client.query(
            `INSERT INTO application_answers (application_id, question_id, answer) VALUES ($1, $2, $3::jsonb)`,
            [applicationId, questionId, JSON.stringify(answer)]);
        }
        const missed = firstMissedKnockOut(questions, answerMap);
        if (missed) {
          await client.query(`UPDATE applications SET state = 'rejected' WHERE id = $1`, [applicationId]);
          await client.query(
            `INSERT INTO application_history (id, application_id, state, at, by, reason)
             VALUES ($1, $2, 'rejected', $3, 'automatic', $4)`,
            [newId(), applicationId, now, missed]);
        }
      });
      const missed = firstMissedKnockOut(questions, answerMap);
      if (missed) {
        const applicant = await getMemberById(viewerId);
        if (applicant) sendMail(applicant.email, `Update on your application for ${job.title}`, 'Not selected');
        await notifyApplicant(viewerId, job.id, applicationId, 'rejected');
      } else {
        await notifyApplicant(viewerId, job.id, applicationId, 'applied');
      }
      const application = await applicationById(applicationId);
      if (!application) throw errors.notFound();
      return { status: 201, body: await applicationObject(application, viewerId) };
    });
  }));

  router.get('/jobs/:id/applications', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const job = await loadJob(req.params.id);
    if (!job) throw errors.notFound();
    if (viewerId !== job.poster_id) throw errors.notPoster();
    const applications = await query(
      `SELECT id, applicant_id, state, created_at FROM applications WHERE job_id = $1 ORDER BY created_at ASC`, [job.id]);
    const columns: Record<string, unknown[]> = {};
    for (const stage of STAGES) columns[stage.state] = [];
    for (const application of applications.rows) {
      const entered = (await historyFor(application.id)).filter((h) => h.state === application.state);
      const applicant = await getMemberById(application.applicant_id);
      if (!applicant) continue;
      columns[application.state].push({
        id: application.id,
        applicant: { id: applicant.id, name: applicant.name, handle: applicant.handle, headline: applicant.headline },
        state: application.state,
        entered_at: (entered[entered.length - 1]?.at ?? application.created_at).toISOString(),
      });
    }
    for (const stage of STAGES) {
      (columns[stage.state] as { entered_at: string; id: string }[]).sort((a, b) =>
        a.entered_at === b.entered_at ? a.id.localeCompare(b.id) : (a.entered_at < b.entered_at ? -1 : 1));
    }
    res.json({ columns });
  }));

  router.get('/applications/:id', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const application = await applicationById(req.params.id);
    if (!application) throw errors.notFound();
    const job = await loadJob(application.job_id);
    if (!job) throw errors.notFound();
    if (viewerId !== application.applicant_id && viewerId !== job.poster_id) throw errors.notFound();
    // The poster's first open moves applied to viewed.
    if (viewerId === job.poster_id && application.state === 'applied') {
      const now = new Date(businessMs());
      await query(`UPDATE applications SET state = 'viewed' WHERE id = $1`, [application.id]);
      await query(
        `INSERT INTO application_history (id, application_id, state, at, by, reason) VALUES ($1, $2, 'viewed', $3, 'hiring_team', NULL)`,
        [newId(), application.id, now]);
      application.state = 'viewed';
      pushTo(application.applicant_id, 'application_update', { application_id: application.id });
    }
    res.json(await applicationObject(application, viewerId));
  }));

  router.post('/applications/:id/transition', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const application = await applicationById(req.params.id);
    if (!application) throw errors.notFound();
    const job = await loadJob(application.job_id);
    if (!job) throw errors.notFound();
    const { to } = (req.body ?? {}) as { to?: string };
    if (!to || !STAGES.some((s) => s.state === to)) throw errors.notFound();
    if (viewerId !== application.applicant_id && viewerId !== job.poster_id) {
      throw viewerId === job.poster_id ? errors.notApplicant() : errors.notPoster();
    }
    if (viewerId === application.applicant_id) {
      // The applicant may only withdraw.
      if (to !== 'withdrawn') throw errors.notPoster();
    } else if (to === 'withdrawn') {
      throw errors.notApplicant();
    }
    if (!isLegalMove(application.state, to)) {
      throw conflict({ error: 'invalid_transition', from: application.state, to });
    }
    const now = new Date(businessMs());
    await withTransaction(async (client) => {
      const check = await client.query(`SELECT state FROM applications WHERE id = $1 FOR UPDATE`, [application.id]);
      if (check.rows[0].state !== application.state) {
        throw conflict({ error: 'invalid_transition', from: check.rows[0].state, to });
      }
      await client.query(`UPDATE applications SET state = $1 WHERE id = $2`, [to, application.id]);
      await client.query(
        `INSERT INTO application_history (id, application_id, state, at, by, reason) VALUES ($1, $2, $3, $4, $5, NULL)`,
        [newId(), application.id, to, now, viewerId === application.applicant_id ? 'you' : 'hiring_team']);
    });
    if (to === 'rejected') {
      const applicant = await getMemberById(application.applicant_id);
      if (applicant) sendMail(applicant.email, `Update on your application for ${job.title}`, 'Not selected');
    }
    await notifyApplicant(application.applicant_id, job.id, application.id, to);
    pushTo(application.applicant_id, 'application_update', { application_id: application.id });
    pushTo(job.poster_id, 'application_update', { application_id: application.id, job_id: job.id });
    const fresh = await applicationById(application.id);
    if (!fresh) throw errors.notFound();
    res.json(await applicationObject(fresh, viewerId));
  }));

  router.get('/applications/:id/resume', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const application = await applicationById(req.params.id);
    if (!application) throw errors.notFound();
    const job = await loadJob(application.job_id);
    if (!job) throw errors.notFound();
    if (viewerId !== application.applicant_id && viewerId !== job.poster_id) throw errors.notFound();
    if (!application.resume_id) throw errors.notFound();
    const data = await getObject(`resumes/${application.applicant_id}/${application.resume_id}.pdf`).catch(() => null);
    if (!data) throw errors.storageUnavailable();
    res.setHeader('Content-Type', 'application/pdf');
    res.send(data);
  }));

  router.post('/uploads/resume', uploadResumeRoute);

  return router;
};

const sqlNow = (): Date => new Date(businessMs());

const notifyAdmins = (jobId: string, exceptMemberId: string): void => {
  void query(`SELECT member_id FROM editor_presence WHERE job_id = $1 AND member_id <> $2`, [jobId, exceptMemberId])
    .then((result) => {
      for (const row of result.rows) pushTo(row.member_id, 'job_update', { job_id: jobId });
    });
};

const uploadResumeRoute = wrap(async (req, res) => {
  const viewerId = req.auth!.memberId;
  const busboy = Busboy({ headers: req.headers, limits: { fileSize: config.resumeMaxBytes + 65536 } });
  const chunks: Buffer[] = [];
  let tooLarge = false;
  let size = 0;
  await new Promise<void>((resolve) => {
    busboy.on('file', (_name, stream) => {
      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > config.resumeMaxBytes) { tooLarge = true; return; }
        chunks.push(chunk);
      });
      stream.on('limit', () => { tooLarge = true; });
      stream.on('end', () => resolve());
    });
    req.pipe(busboy);
  });
  if (tooLarge) throw new ApiError(422, { error: 'resume_too_large', limit: config.resumeMaxBytes });
  const file = Buffer.concat(chunks);
  if (file.length > config.resumeMaxBytes) throw new ApiError(422, { error: 'resume_too_large', limit: config.resumeMaxBytes });
  if (file.subarray(0, 5).toString('ascii') !== '%PDF-') throw new ApiError(422, { error: 'resume_type' });
  const resumeId = newId();
  const sha256 = createHash('sha256').update(file).digest('hex');
  const ok = await putObject(`resumes/${viewerId}/${resumeId}.pdf`, file).catch(() => false);
  if (!ok) throw errors.storageUnavailable();
  await query(
    `INSERT INTO uploads (id, kind, owner_id, content_type, bytes, sha256, created_at)
     VALUES ($1, 'resume', $2, 'application/pdf', $3, $4, $5)`,
    [resumeId, viewerId, file.length, sha256, new Date(businessMs())]);
  res.status(201).json({ resume_id: resumeId, bytes: file.length, sha256 });
});
