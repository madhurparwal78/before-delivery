import { randomUUID } from 'node:crypto';
import { computeCosts } from '../costs.js';
import { formatMoney, readChangeOrderAmount, readContingencyPercent } from '../core/money.js';
import { db } from '../db.js';
import { ApiError, fail } from '../errors.js';
import { jobWrite } from '../events.js';
import { body, requireAccount, route, sendJson, type Ctx, type Route } from '../http.js';
import { requireJob, requireOpenJob, requireRole, requireUuid } from '../jobctx.js';

type ChangeOrderRow = {
  id: string;
  description: string;
  amount: string;
  status: string;
  created_at: Date;
  approved_at: Date | null;
};

function projectChangeOrder(row: ChangeOrderRow): Record<string, unknown> {
  return {
    id: row.id,
    description: row.description,
    amount: formatMoney(BigInt(row.amount)),
    status: row.status,
    created_at: row.created_at.toISOString(),
    approved_at: row.approved_at === null ? null : row.approved_at.toISOString(),
  };
}

export const costRoutes: Route[] = [
  route('GET', '/api/jobs/:jobId/costs', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    requireRole(jobCtx, ['owner', 'lead']);
    const raw = ctx.query.get('as_of');
    let asOf = new Date();
    if (raw !== null && raw !== '') {
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) {
        throw new ApiError('validation', { fields: { as_of: 'Give a UTC time such as 2030-03-04T12:00:00Z.' } });
      }
      asOf = parsed;
    }
    sendJson(ctx.res, 200, await computeCosts(db, jobCtx.job.id, asOf));
  }),

  route('PUT', '/api/jobs/:jobId/contingency', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    requireRole(jobCtx, ['owner']);
    requireOpenJob(jobCtx);
    const percent = readContingencyPercent(body(ctx).percent);
    if (percent === null) {
      throw new ApiError('validation', {
        fields: { percent: 'Give a percent from 0.00 to 25.00 as text.' },
      });
    }
    const effectiveAt = new Date();
    await jobWrite(jobCtx.job.id, async (tx) => {
      await tx.query(
        `insert into contingency_settings (id, job_id, percent, effective_at)
         values ($1, $2, $3, $4)`,
        [randomUUID(), jobCtx.job.id, percent.toString(), effectiveAt.toISOString()],
      );
    });
    sendJson(ctx.res, 200, {
      percent: formatMoney(percent),
      effective_at: effectiveAt.toISOString(),
    });
  }),

  route('GET', '/api/jobs/:jobId/change-orders', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    requireRole(jobCtx, ['owner', 'lead']);
    const { rows } = await db.query(
      `select id, description, amount, status, created_at, approved_at
         from change_orders where job_id = $1 order by created_at, id`,
      [jobCtx.job.id],
    );
    sendJson(ctx.res, 200, {
      change_orders: rows.map((row) => projectChangeOrder(row as unknown as ChangeOrderRow)),
    });
  }),

  route('POST', '/api/jobs/:jobId/change-orders', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    requireRole(jobCtx, ['owner', 'lead']);
    requireOpenJob(jobCtx);
    const raw = body(ctx);
    const fields: Record<string, string> = {};
    const description = raw.description;
    if (typeof description !== 'string' || description.length < 1 || description.length > 200) {
      fields.description = 'Give a description of 1 to 200 characters.';
    }
    const amount = readChangeOrderAmount(raw.amount);
    if (amount === null) {
      fields.amount = 'Give a non-zero amount from -99999.99 to 99999.99 as text.';
    }
    if (Object.keys(fields).length > 0) throw new ApiError('validation', { fields });

    const id = randomUUID();
    await jobWrite(jobCtx.job.id, async (tx) => {
      await tx.query(
        `insert into change_orders (id, job_id, description, amount, status, created_at)
         values ($1, $2, $3, $4, 'pending', now())`,
        [id, jobCtx.job.id, description, amount!.toString()],
      );
    });
    const { rows } = await db.query(
      `select id, description, amount, status, created_at, approved_at from change_orders where id = $1`,
      [id],
    );
    sendJson(ctx.res, 201, projectChangeOrder(rows[0] as unknown as ChangeOrderRow));
  }),

  route('POST', '/api/jobs/:jobId/change-orders/:id/approve', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    requireRole(jobCtx, ['owner']);
    requireUuid(ctx.params.id);
    const existing = await db.query(
      `select id, status from change_orders where job_id = $1 and id = $2`,
      [jobCtx.job.id, ctx.params.id],
    );
    if (existing.rowCount === 0) fail('not_found');
    requireOpenJob(jobCtx);
    await jobWrite(jobCtx.job.id, async (tx) => {
      const claim = await tx.query(
        `update change_orders set status = 'approved', approved_at = now()
          where id = $1 and status = 'pending' returning id`,
        [ctx.params.id],
      );
      if (claim.rowCount === 0) fail('invalid_transition');
    });
    const { rows } = await db.query(
      `select id, description, amount, status, created_at, approved_at from change_orders where id = $1`,
      [ctx.params.id],
    );
    sendJson(ctx.res, 200, projectChangeOrder(rows[0] as unknown as ChangeOrderRow));
  }),
];
