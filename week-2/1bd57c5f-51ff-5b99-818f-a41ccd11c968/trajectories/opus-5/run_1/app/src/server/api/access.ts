import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { ApiError, fail } from '../errors.js';
import { body, requireAccount, route, sendJson, type Ctx, type Route } from '../http.js';
import { requireJob, requireOpenJob, requireRole } from '../jobctx.js';
import { accessAvailability } from '../jobview.js';

type Card = {
  lockbox_code: string;
  alarm_code: string;
  garage_code: string;
  house_note: string;
};

async function readCard(jobId: string): Promise<Card> {
  const { rows } = await db.query(
    `select lockbox_code, alarm_code, garage_code, house_note from access_cards where job_id = $1`,
    [jobId],
  );
  if (rows.length === 0) {
    return { lockbox_code: '', alarm_code: '', garage_code: '', house_note: '' };
  }
  return rows[0] as unknown as Card;
}

export const accessRoutes: Route[] = [
  route('GET', '/api/jobs/:jobId/access', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    if (jobCtx.viewer.role === 'homeowner') fail('forbidden');
    const now = new Date();
    const access = await accessAvailability(db, jobCtx.job, jobCtx.viewer, now);
    if (!access.available) fail('outside_site_visit');
    const card = await readCard(jobCtx.job.id);
    await db.query(
      `insert into code_reveals (id, job_id, person_id, revealed_at) values ($1, $2, $3, $4)`,
      [randomUUID(), jobCtx.job.id, jobCtx.viewer.personId, now.toISOString()],
    );
    sendJson(ctx.res, 200, {
      ...card,
      visible_until: access.visibleUntil === null ? null : access.visibleUntil.toISOString(),
    });
  }),

  route('PUT', '/api/jobs/:jobId/access', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    requireRole(jobCtx, ['owner']);
    requireOpenJob(jobCtx);
    const raw = body(ctx);
    const fields: Record<string, string> = {};
    const codes = ['lockbox_code', 'alarm_code', 'garage_code'] as const;
    for (const key of codes) {
      const value = raw[key];
      if (typeof value !== 'string' || value.length > 40) {
        fields[key] = 'Keep a code to 40 characters.';
      }
    }
    const note = raw.house_note;
    if (typeof note !== 'string' || note.length > 500) {
      fields.house_note = 'Keep the house note to 500 characters.';
    }
    if (Object.keys(fields).length > 0) throw new ApiError('validation', { fields });

    await db.query(
      `insert into access_cards (job_id, lockbox_code, alarm_code, garage_code, house_note)
       values ($1, $2, $3, $4, $5)
       on conflict (job_id) do update
          set lockbox_code = excluded.lockbox_code,
              alarm_code = excluded.alarm_code,
              garage_code = excluded.garage_code,
              house_note = excluded.house_note`,
      [jobCtx.job.id, raw.lockbox_code, raw.alarm_code, raw.garage_code, note],
    );
    sendJson(ctx.res, 200, { ...(await readCard(jobCtx.job.id)), visible_until: null });
  }),

  route('GET', '/api/jobs/:jobId/access/reveals', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    requireRole(jobCtx, ['owner']);
    const { rows } = await db.query(
      `select p.name, coalesce(m.role, 'owner') as role, r.revealed_at
         from code_reveals r
         join people p on p.id = r.person_id
         left join job_members m on m.job_id = r.job_id and m.person_id = r.person_id
        where r.job_id = $1
        order by r.revealed_at desc, r.id desc`,
      [jobCtx.job.id],
    );
    sendJson(ctx.res, 200, {
      reveals: rows.map((row) => ({
        name: row.name,
        role: row.role,
        revealed_at: (row.revealed_at as Date).toISOString(),
      })),
    });
  }),
];
