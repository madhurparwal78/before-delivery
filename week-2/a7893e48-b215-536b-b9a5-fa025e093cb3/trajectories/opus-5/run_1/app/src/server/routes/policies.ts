import { randomUUID } from 'node:crypto';
import { pool, query, queryOne } from '../db/pool.js';
import { siteInScope } from '../domain/records.js';
import { isDateString, localDate, startOfLocalDay } from '../domain/zone.js';
import { json, type Ctx, type Reply } from '../http/context.js';
import { ApiError, validation } from '../http/errors.js';
import type { Route } from '../http/router.js';

interface PolicyRow {
  id: string;
  notice_hours: number;
  effective_from: string;
  effective_at: Date;
  created_by_name: string;
  created_at: Date;
}

async function schedulePolicy(ctx: Ctx): Promise<Reply> {
  const actor = ctx.requireActor();
  const site = await siteInScope(actor, ctx.params.id as string);
  ctx.requireRole('manager');
  const body = ctx.body();
  const fields: Record<string, string> = {};
  const noticeHours = body.notice_hours;
  if (
    typeof noticeHours !== 'number' ||
    !Number.isInteger(noticeHours) ||
    noticeHours < 1 ||
    noticeHours > 168
  ) {
    fields.notice_hours = 'Give a notice period between 1 and 168 hours.';
  }
  if (!isDateString(body.effective_from)) {
    fields.effective_from = 'Give a date as YYYY-MM-DD.';
  } else if ((body.effective_from as string) < localDate(site.time_zone, new Date())) {
    fields.effective_from = 'Start today or later.';
  }
  if (Object.keys(fields).length > 0) throw validation(fields);

  const effectiveFrom = body.effective_from as string;
  const midnight = startOfLocalDay(site.time_zone, effectiveFrom);
  const now = new Date();
  const effectiveAt = midnight.getTime() > now.getTime() ? midnight : now;
  const existing = await queryOne<{ id: string }>(
    pool,
    'SELECT id FROM policy_versions WHERE site_id = $1 AND effective_from = $2::date',
    [site.id, effectiveFrom],
  );
  if (existing) {
    throw new ApiError(409, 'policy_date_taken', 'A policy already starts on that date.', {});
  }
  const inserted = await pool.query<PolicyRow>(
    `INSERT INTO policy_versions (id, site_id, notice_hours, effective_from, effective_at, created_by_name)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, notice_hours, effective_from, effective_at, created_by_name, created_at`,
    [`pv-${randomUUID()}`, site.id, noticeHours, effectiveFrom, effectiveAt, actor.name],
  );
  const row = inserted.rows[0];
  if (row === undefined) throw new Error('policy insert returned nothing');
  return json(201, {
    version: {
      id: row.id,
      notice_hours: row.notice_hours,
      effective_from: row.effective_from,
      effective_at: row.effective_at.toISOString(),
      created_by_name: row.created_by_name,
      created_at: row.created_at.toISOString(),
    },
  });
}

export const policyRoutes: Route[] = [
  {
    method: 'GET',
    pattern: '/api/sites/:id/policies',
    handle: async (ctx): Promise<Reply> => {
      const actor = ctx.requireActor();
      const site = await siteInScope(actor, ctx.params.id as string);
      ctx.requireRole('manager');
      const rows = await query<PolicyRow>(
        pool,
        `SELECT id, notice_hours, effective_from, effective_at, created_by_name, created_at
           FROM policy_versions WHERE site_id = $1 ORDER BY effective_at DESC, created_at DESC`,
        [site.id],
      );
      return json(200, {
        versions: rows.map((row) => ({
          id: row.id,
          notice_hours: row.notice_hours,
          effective_from: row.effective_from,
          effective_at: row.effective_at.toISOString(),
          created_by_name: row.created_by_name,
          created_at: row.created_at.toISOString(),
        })),
      });
    },
  },
  { method: 'POST', pattern: '/api/sites/:id/policies', handle: schedulePolicy },
];
