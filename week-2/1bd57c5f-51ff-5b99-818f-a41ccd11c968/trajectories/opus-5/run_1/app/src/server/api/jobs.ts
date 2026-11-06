import { randomUUID } from 'node:crypto';
import { db, withTransaction } from '../db.js';
import { ApiError, fail } from '../errors.js';
import { emitJob, jobWrite } from '../events.js';
import { body, requireAccount, route, sendJson, type Ctx, type Route } from '../http.js';
import { requireJob, requireRole } from '../jobctx.js';
import { projectJob } from '../jobview.js';
import { isValidTimeZone } from '../core/timezone.js';
import { loadItems, loadJob } from '../model.js';
import { deletePrefix, StorageUnavailable } from '../services/objectstore.js';

export const jobRoutes: Route[] = [
  route('GET', '/api/jobs', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const { rows } = await db.query(
      `select j.id from jobs j
         join job_members m on m.job_id = j.id and m.person_id = $1 and m.active
        order by j.created_at desc, j.id desc`,
      [account.person.id],
    );
    const now = new Date();
    const jobs: unknown[] = [];
    for (const row of rows) {
      const ctxForJob = await requireJob(db, account, row.id as string);
      jobs.push(await projectJob(db, ctxForJob.job, ctxForJob.viewer, now));
    }
    sendJson(ctx.res, 200, { jobs });
  }),

  route('POST', '/api/jobs', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    if (!account.person.isOwner) fail('forbidden');
    const raw = body(ctx);
    const fields: Record<string, string> = {};
    const name = raw.name;
    const address = raw.address;
    const timeZone = raw.time_zone;
    if (typeof name !== 'string' || name.length < 1 || name.length > 120) {
      fields.name = 'Give the job a name of 1 to 120 characters.';
    }
    if (typeof address !== 'string' || address.length < 1 || address.length > 200) {
      fields.address = 'Give an address of 1 to 200 characters.';
    }
    if (typeof timeZone !== 'string' || !isValidTimeZone(timeZone)) {
      fields.time_zone = 'Choose a time zone such as America/Chicago.';
    }
    if (Object.keys(fields).length > 0) throw new ApiError('validation', { fields });

    const firm = await db.query(`select id from firms limit 1`);
    const jobId = randomUUID();
    await withTransaction(async (tx) => {
      await tx.query(
        `insert into jobs (id, firm_id, name, address, time_zone, status, created_at)
         values ($1, $2, $3, $4, $5, 'active', now())`,
        [jobId, firm.rows[0].id, name, address, timeZone],
      );
      await tx.query(`insert into access_cards (job_id) values ($1)`, [jobId]);
      await tx.query(
        `insert into job_members (id, job_id, person_id, role, trade, active)
         values ($1, $2, $3, 'owner', null, true)`,
        [randomUUID(), jobId, account.person.id],
      );
    });
    const created = await requireJob(db, account, jobId);
    sendJson(ctx.res, 201, await projectJob(db, created.job, created.viewer, new Date()));
  }),

  route('GET', '/api/jobs/:jobId', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    sendJson(ctx.res, 200, await projectJob(db, jobCtx.job, jobCtx.viewer, new Date()));
  }),

  route('POST', '/api/jobs/:jobId/actions', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    requireRole(jobCtx, ['owner']);
    const raw = body(ctx);
    const action = raw.action;
    if (action !== 'start_walkthrough' && action !== 'close_out') {
      throw new ApiError('validation', { fields: { action: 'Choose a stage step.' } });
    }
    if (jobCtx.job.status === 'closed_out') fail('job_closed');

    if (action === 'start_walkthrough') {
      if (jobCtx.job.status !== 'active') fail('invalid_transition');
      await jobWrite(jobCtx.job.id, async (tx) => {
        await tx.query(`update jobs set status = 'walkthrough' where id = $1`, [jobCtx.job.id]);
        await emitJob(tx, jobCtx.job.id);
      });
    } else {
      if (jobCtx.job.status !== 'walkthrough') fail('invalid_transition');
      const items = await loadItems(db, jobCtx.job.id);
      const unverified = items.filter((item) => item.status !== 'verified').length;
      if (unverified > 0) fail('items_not_verified', { unverified });
      try {
        await deletePrefix(`jobs/${jobCtx.job.id}/`);
      } catch (error) {
        if (error instanceof StorageUnavailable) fail('storage_unavailable');
        throw error;
      }
      await jobWrite(jobCtx.job.id, async (tx) => {
        await tx.query(`delete from photos where job_id = $1`, [jobCtx.job.id]);
        await tx.query(`delete from plan_revisions where job_id = $1`, [jobCtx.job.id]);
        await tx.query(`update jobs set status = 'closed_out' where id = $1`, [jobCtx.job.id]);
        await emitJob(tx, jobCtx.job.id);
      });
    }
    const after = await loadJob(db, jobCtx.job.id);
    sendJson(ctx.res, 200, await projectJob(db, after!, jobCtx.viewer, new Date()));
  }),

  route('GET', '/api/jobs/:jobId/outbox', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    requireRole(jobCtx, ['owner']);
    const { rows } = await db.query(
      `select id, kind, to_email, subject, status, created_at, sent_at
         from outbox where job_id = $1 order by created_at desc, id desc`,
      [jobCtx.job.id],
    );
    sendJson(ctx.res, 200, {
      entries: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        to: row.to_email,
        subject: row.subject,
        status: row.status,
        created_at: (row.created_at as Date).toISOString(),
        sent_at: row.sent_at === null ? null : (row.sent_at as Date).toISOString(),
      })),
    });
  }),

  route(
    'GET',
    '/api/health',
    async (ctx: Ctx) => {
      sendJson(ctx.res, 200, { status: 'ok' });
    },
    true,
  ),
];
