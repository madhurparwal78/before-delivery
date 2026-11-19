import { errors } from '../errors.js';
import { requireMember, requireUser } from '../access.js';
import { jsonOk } from './api.js';
import type { ApiDeps, RouteSpec } from './api.js';
import type { RequestCtx } from '../router.js';
import { sessionCookieValue } from './auth.js';

const PAGE_SIZE = 50;

export async function listActivity (deps: ApiDeps, ctx: RequestCtx): Promise<void> {
  const user = await requireUser(deps, sessionCookieValue(ctx));
  await requireMember(deps, ctx.params.setId, user.id);
  const before = ctx.url.searchParams.get('before');
  const result = await deps.pool.query(
    before === null
      ? `SELECT a.id, a.at, a.actor_id, a.action, a.target, a.summary, u.display_name
           FROM activity a JOIN users u ON u.id = a.actor_id
          WHERE a.set_id = $1 ORDER BY a.at DESC, a.id DESC LIMIT $2`
      : `SELECT a.id, a.at, a.actor_id, a.action, a.target, a.summary, u.display_name
           FROM activity a JOIN users u ON u.id = a.actor_id
          WHERE a.set_id = $1 AND a.at < (SELECT at FROM activity WHERE id = $2)
          ORDER BY a.at DESC, a.id DESC LIMIT $3`,
    before === null ? [ctx.params.setId, PAGE_SIZE] : [ctx.params.setId, before, PAGE_SIZE],
  );
  jsonOk(ctx, 200, {
    entries: result.rows.map((row: Record<string, unknown>) => ({
      id: row.id,
      at: (row.at as Date).toISOString(),
      actor: { user_id: row.actor_id, display_name: row.display_name },
      action: row.action,
      target: row.target,
      summary: row.summary,
    })),
  });
}

export const activityRoutes = (deps: ApiDeps): RouteSpec[] => ([
  { method: 'GET', path: '/api/sets/:setId/activity', handler: (ctx) => listActivity(deps, ctx) },
]);
