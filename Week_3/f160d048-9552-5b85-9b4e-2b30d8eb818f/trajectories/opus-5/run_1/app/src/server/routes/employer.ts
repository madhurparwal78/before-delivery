import { isStage, STAGE_LABELS, type Stage } from '../../shared/reference';
import { config } from '../config';
import { db, transaction, type Db } from '../db/pool';
import { matchNewlyListedJob } from '../domain/alerts';
import { assertNoContactDetails, postedMonth } from '../domain/anonymity';
import { isLegalStageMove } from '../domain/pipeline';
import { findCompanyById, toJobSummary } from '../domain/projection';
import { assertPng, chargeUploadRate, dateOnly } from '../domain/uploads';
import { COPY, emailValue, FieldErrors, integerBetween, refs, textBetween } from '../domain/validate';
import { ApiError } from '../errors';
import type { Context, SessionUser } from '../http/context';
import { sendJson } from '../http/respond';
import { HANDLED, type Router } from '../http/router';
import { sixDigitCode, uuid } from '../ids';
import { publish } from '../services/live';
import { letters, queueLetter } from '../services/mail';
import * as search from '../services/search';
import { flushSyncQuietly, jobDocumentFrom, queueSync } from '../services/sync';
import {
  applicantBody,
  APPLICATION_COLUMNS,
  APPLICATION_FROM,
  findApplication,
  type ApplicationRow,
} from './applications';
import { findJob } from './jobs';
import { markKey, putAndConfirm, StorageUnavailable } from '../services/storage';

interface JobOutRow {
  id: string;
  title: string;
  company_id: string;
  company_name: string;
  company_slug: string;
  city: 'harrowgate' | 'kelvane' | 'brindlemoor' | 'saltmere';
  role_family: 'research_assistant' | 'qc_analyst' | 'lab_manager' | 'core_facility';
  remote: 'on_site' | 'hybrid' | 'remote';
  pay_low: number;
  pay_high: number;
  description: string;
  status: string;
  listed_at: Date | null;
}

function jobBody(row: JobOutRow): unknown {
  return { ...toJobSummary(row), description: row.description, status: row.status };
}

/** A team route needs a user of the record's company; verification is checked after. */
function requireTeamOf(ctx: Context, companyId: string): SessionUser {
  const user = ctx.requireUser();
  if (user.company_id !== companyId || (user.role !== 'employer_admin' && user.role !== 'recruiter')) {
    throw new ApiError('not_found');
  }
  return user;
}

async function requireVerified(companyId: string): Promise<void> {
  const company = await findCompanyById(companyId);
  if (!company?.verified) throw new ApiError('not_verified');
}

function requireOwnCompany(ctx: Context): SessionUser {
  const user = ctx.requireRole('employer_admin', 'recruiter');
  if (!user.company_id) throw new ApiError('forbidden');
  return user;
}

async function companyJob(ctx: Context, id: string): Promise<JobOutRow> {
  const job = await findJob(id);
  if (!job) throw new ApiError('not_found');
  requireTeamOf(ctx, job.company_id);
  return job as JobOutRow;
}

async function listJobNow(job: JobOutRow, now: Date): Promise<JobOutRow> {
  const document = jobDocumentFrom({ ...job, listed_at: now, status: 'listed' });
  try {
    await search.upsertJob(document);
  } catch {
    throw new ApiError('search_unavailable');
  }
  await db.query(`UPDATE jobs SET status = 'listed', listed_at = $2 WHERE id = $1`, [job.id, now]);
  const listed: JobOutRow = { ...job, status: 'listed', listed_at: now };
  await matchNewlyListedJob(
    {
      id: job.id,
      company_id: job.company_id,
      city: job.city,
      role_family: job.role_family,
      remote: job.remote,
      pay_band: document.pay_band,
    },
    now,
  );
  return listed;
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function registerEmployerRoutes(router: Router): void {
  router.post('/api/employer/verification/request', async (ctx: Context) => {
    const user = ctx.requireRole('employer_admin');
    if (!user.company_id) throw new ApiError('forbidden');
    const company = await findCompanyById(user.company_id);
    if (!company) throw new ApiError('not_found');
    const now = await ctx.now();

    const window = new Date(now.getTime() - config.emailCodeTtlSeconds * 1000);
    const recent = await db.one<{ count: string }>(
      'SELECT count(*) AS count FROM verification_codes WHERE company_id = $1 AND issued_at > $2',
      [company.id, window],
    );
    if (Number(recent?.count ?? 0) >= 3) throw new ApiError('rate_limited');

    const body = ctx.json();
    const email = emailValue(body['email']);
    const domain = email?.split('@')[1]?.toLowerCase();
    if (!email || domain !== company.email_domain.toLowerCase()) {
      throw new ApiError('validation_failed', { fields: { email: `Use an address at ${company.email_domain}.` } });
    }

    const code = sixDigitCode();
    await transaction(async (tx) => {
      await tx.query('UPDATE verification_codes SET superseded = true WHERE company_id = $1', [company.id]);
      await tx.query(
        'INSERT INTO verification_codes (id, company_id, email, code, issued_at) VALUES ($1, $2, $3, $4, $5)',
        [uuid(), company.id, email, code, now],
      );
      await queueLetter(tx, now, letters.verificationCode(email, code));
    });
    sendJson(ctx.res, 202, { status: 'queued' });
    return HANDLED;
  });

  router.post('/api/employer/verification/confirm', async (ctx: Context) => {
    const user = ctx.requireRole('employer_admin');
    if (!user.company_id) throw new ApiError('forbidden');
    const company = await findCompanyById(user.company_id);
    if (!company) throw new ApiError('not_found');
    const body = ctx.json();
    const code = typeof body['code'] === 'string' ? body['code'].trim() : '';
    const now = await ctx.now();

    const current = await db.one<{ id: string; code: string; issued_at: Date }>(
      `SELECT id, code, issued_at FROM verification_codes
        WHERE company_id = $1 AND superseded = false ORDER BY issued_at DESC LIMIT 1`,
      [company.id],
    );
    if (!current || current.code !== code) throw new ApiError('code_invalid');
    if (now.getTime() - current.issued_at.getTime() >= config.emailCodeTtlSeconds * 1000) {
      throw new ApiError('code_expired');
    }

    await transaction(async (tx) => {
      await tx.query('UPDATE companies SET verified = true WHERE id = $1', [company.id]);
      await tx.query('UPDATE verification_codes SET superseded = true WHERE id = $1', [current.id]);
      await queueSync(tx, now, 'company', company.id, 'upsert');
      await publish(tx, now, 'company.changed', { slug: company.slug }, { all: true });
    });
    await flushSyncQuietly('company', company.id);
    return { verified: true };
  });

  router.post('/api/employer/reviews/:id/reply', async (ctx: Context) => {
    const review = await db.one<{
      id: string;
      company_id: string;
      company_slug: string;
      company_name: string;
      state: string;
      deleted_at: Date | null;
    }>(
      `SELECT p.id, p.company_id, c.slug AS company_slug, c.name AS company_name, p.state, p.deleted_at
         FROM posts p JOIN companies c ON c.id = p.company_id
        WHERE p.id = $1 AND p.kind = 'review'`,
      [ctx.param('id')],
    );
    if (!review || review.deleted_at || review.state !== 'approved') throw new ApiError('not_found');
    requireTeamOf(ctx, review.company_id);
    await requireVerified(review.company_id);

    const existing = await db.one<{ review_id: string }>('SELECT review_id FROM review_replies WHERE review_id = $1', [
      review.id,
    ]);
    if (existing) throw new ApiError('already_replied');

    const body = ctx.json();
    const text = textBetween(body['body'], 20, 2000);
    if (text === null) throw new ApiError('validation_failed', { fields: { body: COPY.reply_body } });
    assertNoContactDetails([['body', text]]);

    const now = await ctx.now();
    await transaction(async (tx) => {
      await tx.query('INSERT INTO review_replies (review_id, company_id, body, created_at) VALUES ($1, $2, $3, $4)', [
        review.id,
        review.company_id,
        text,
        now,
      ]);
      await queueSync(tx, now, 'company', review.company_id, 'upsert');
      await publish(tx, now, 'company.changed', { slug: review.company_slug }, { all: true });
    });
    await flushSyncQuietly('company', review.company_id);
    sendJson(ctx.res, 201, {
      review_id: review.id,
      company_name: review.company_name,
      body: text,
      posted_month: postedMonth(now),
    });
    return HANDLED;
  });

  router.get('/api/employer/jobs', async (ctx: Context) => {
    const user = requireOwnCompany(ctx);
    const rows = await db.query<JobOutRow>(
      `SELECT j.id, j.title, j.company_id, c.name AS company_name, c.slug AS company_slug, j.city, j.role_family,
              j.remote, j.pay_low, j.pay_high, j.description, j.status, j.listed_at
         FROM jobs j JOIN companies c ON c.id = j.company_id
        WHERE j.company_id = $1 ORDER BY j.created_at DESC, j.id`,
      [user.company_id],
    );
    return { jobs: rows.map(jobBody) };
  });

  router.post('/api/employer/jobs', async (ctx: Context) => {
    const user = requireOwnCompany(ctx);
    await requireVerified(user.company_id as string);
    const body = ctx.json();
    const errors = new FieldErrors();
    const title = textBetween(body['title'], 3, 120);
    const roleFamily = refs.isRoleFamilyId(body['role_family']) ? (body['role_family'] as string) : null;
    const city = refs.isCityId(body['city']) ? (body['city'] as string) : null;
    const remote = refs.isWorkPatternId(body['remote']) ? (body['remote'] as string) : null;
    const payLow = integerBetween(body['pay_low'], 100000, 5000000);
    const payHigh = integerBetween(body['pay_high'], 100000, 5000000);
    const description = textBetween(body['description'], 40, 5000);
    if (!title) errors.add('title', COPY.job_title);
    if (!roleFamily) errors.add('role_family', COPY.role_family);
    if (!city) errors.add('city', COPY.city);
    if (!remote) errors.add('remote', COPY.remote);
    if (payLow === null) errors.add('pay_low', COPY.pay);
    if (payHigh === null) errors.add('pay_high', COPY.pay);
    else if (payLow !== null && payHigh < payLow) errors.add('pay_high', COPY.pay_high);
    if (description === null) errors.add('description', COPY.description);
    errors.throwIfAny();

    const now = await ctx.now();
    const id = uuid();
    const company = await findCompanyById(user.company_id as string);
    await db.query(
      `INSERT INTO jobs (id, company_id, title, role_family, city, remote, pay_low, pay_high, description,
                         status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', $10)`,
      [id, user.company_id, title, roleFamily, city, remote, payLow, payHigh, description, now],
    );
    const draft = (await findJob(id)) as JobOutRow;
    const listed = await listJobNow(
      { ...draft, company_name: company?.name ?? '', company_slug: company?.slug ?? '' },
      now,
    );
    sendJson(ctx.res, 201, jobBody(listed));
    return HANDLED;
  });

  router.post('/api/employer/jobs/:id/list', async (ctx: Context) => {
    const job = await companyJob(ctx, ctx.param('id'));
    await requireVerified(job.company_id);
    return jobBody(await listJobNow(job, await ctx.now()));
  });

  router.post('/api/employer/jobs/:id/close', async (ctx: Context) => {
    const job = await companyJob(ctx, ctx.param('id'));
    await requireVerified(job.company_id);
    const now = await ctx.now();
    await transaction(async (tx) => {
      await tx.query(`UPDATE jobs SET status = 'closed' WHERE id = $1`, [job.id]);
      await queueSync(tx, now, 'job', job.id, 'delete');
    });
    await flushSyncQuietly('job', job.id);
    return jobBody({ ...job, status: 'closed' });
  });

  router.get('/api/employer/jobs/:id/applicants', async (ctx: Context) => {
    const job = await companyJob(ctx, ctx.param('id'));
    const rows = await db.query<ApplicationRow>(
      `SELECT ${APPLICATION_COLUMNS} ${APPLICATION_FROM} WHERE a.job_id = $1 ORDER BY a.applied_at DESC, a.id`,
      [job.id],
    );
    return { applicants: rows.map(applicantBody) };
  });

  router.get('/api/employer/jobs/:id/applicants.csv', async (ctx: Context) => {
    const job = await companyJob(ctx, ctx.param('id'));
    const rows = await db.query<ApplicationRow>(
      `SELECT ${APPLICATION_COLUMNS} ${APPLICATION_FROM} WHERE a.job_id = $1 ORDER BY a.applied_at DESC, a.id ASC`,
      [job.id],
    );
    const lines = ['application_id,candidate_name,job_title,stage,applied_on,updated_on'];
    for (const row of rows) {
      lines.push(
        [row.id, row.candidate_name, row.job_title, row.stage, dateOnly(row.applied_at), dateOnly(row.updated_at)]
          .map(csvField)
          .join(','),
      );
    }
    const payload = Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8');
    ctx.res.writeHead(200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-length': payload.length,
      'content-disposition': `attachment; filename="applicants-${job.id}.csv"`,
      'cache-control': 'no-store',
    });
    ctx.res.end(payload);
    return HANDLED;
  });

  router.get('/api/employer/applications/:id', async (ctx: Context) => {
    const application = await findApplication(ctx.param('id'));
    if (!application) throw new ApiError('not_found');
    requireTeamOf(ctx, application.company_id);
    return applicantBody(application);
  });

  router.post('/api/employer/applications/:id/stage', async (ctx: Context) => {
    const application = await findApplication(ctx.param('id'));
    if (!application) throw new ApiError('not_found');
    const user = requireTeamOf(ctx, application.company_id);
    await requireVerified(application.company_id);
    const body = ctx.json();
    const stage = isStage(body['stage']) ? (body['stage'] as Stage) : null;
    if (!stage) throw new ApiError('validation_failed', { fields: { stage: COPY.stage } });
    const now = await ctx.now();

    const moved = await transaction(async (tx: Db) => {
      const current = await tx.one<{ stage: Stage }>('SELECT stage FROM applications WHERE id = $1 FOR UPDATE', [
        application.id,
      ]);
      if (!current) throw new ApiError('not_found');
      if (!isLegalStageMove(current.stage, stage)) throw new ApiError('invalid_transition');
      await tx.query('UPDATE applications SET stage = $2, updated_at = $3 WHERE id = $1', [application.id, stage, now]);
      await tx.query('INSERT INTO application_stages (application_id, stage, at) VALUES ($1, $2, $3)', [
        application.id,
        stage,
        now,
      ]);
      await tx.query(
        `INSERT INTO audit_log (action, actor_id, subject_id, detail, at) VALUES ('stage', $1, $2, $3, $4)`,
        [user.id, application.id, JSON.stringify({ from: current.stage, to: stage }), now],
      );
      await publish(
        tx,
        now,
        'application.stage',
        { application_id: application.id, job_id: application.job_id, stage },
        { user_ids: [application.user_id], company_ids: [application.company_id] },
      );
      await queueLetter(
        tx,
        now,
        letters.stageChange(
          application.contact_email,
          application.job_title,
          application.company_name,
          STAGE_LABELS[stage],
        ),
      );
      return { ...application, stage, updated_at: now };
    });
    return applicantBody(moved);
  });

  router.put(
    '/api/employer/company/mark',
    async (ctx: Context) => {
      const user = requireOwnCompany(ctx);
      const company = await findCompanyById(user.company_id as string);
      if (!company) throw new ApiError('not_found');
      await requireVerified(company.id);
      const now = await ctx.now();
      await chargeUploadRate(user.id, now);
      const bytes = ctx.raw();
      assertPng(bytes);

      const fileId = company.mark_file_id ?? uuid();
      try {
        await putAndConfirm(markKey(company.id), bytes, 'image/png');
      } catch (error) {
        if (error instanceof StorageUnavailable) throw new ApiError('storage_unavailable');
        throw error;
      }
      await transaction(async (tx) => {
        await tx.query(
          `INSERT INTO stored_files (id, kind, storage_key, content_type, byte_size, company_id, created_at)
         VALUES ($1, 'mark', $2, 'image/png', $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET byte_size = $3, created_at = $5`,
          [fileId, markKey(company.id), bytes.length, company.id, now],
        );
        await tx.query('UPDATE companies SET mark_file_id = $2 WHERE id = $1', [company.id, fileId]);
        await publish(tx, now, 'company.changed', { slug: company.slug }, { all: true });
      });
      return { mark_url: `/api/files/${fileId}` };
    },
    'raw',
  );
}
