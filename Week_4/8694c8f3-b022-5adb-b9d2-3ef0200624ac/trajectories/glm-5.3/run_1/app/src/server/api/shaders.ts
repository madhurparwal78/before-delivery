import { errors } from '../errors.js';
import { requireMember, requireUser } from '../access.js';
import { jsonOk } from './api.js';
import type { ApiDeps, RouteSpec } from './api.js';
import type { RequestCtx } from '../router.js';
import { sessionCookieValue } from './auth.js';

export async function shaderVersions (deps: ApiDeps, ctx: RequestCtx): Promise<void> {
  const user = await requireUser(deps, sessionCookieValue(ctx));
  await requireMember(deps, ctx.params.setId, user.id);
  const result = await deps.pool.query(
    `SELECT v.number, v.sha256, v.size, v.restored_from, v.created_at, u.id AS user_id, u.display_name
       FROM shader_versions v JOIN users u ON u.id = v.author_id
      WHERE v.set_id = $1 AND v.layer_id = $2 ORDER BY v.number DESC`,
    [ctx.params.setId, ctx.params.layerId],
  );
  jsonOk(ctx, 200, {
    versions: result.rows.map((row: Record<string, unknown>) => ({
      number: row.number,
      sha256: row.sha256,
      size: Number(row.size),
      author: { user_id: row.user_id, display_name: row.display_name },
      created_at: (row.created_at as Date).toISOString(),
      restored_from: row.restored_from,
    })),
  });
}

export async function shaderVersionSource (deps: ApiDeps, ctx: RequestCtx): Promise<void> {
  const user = await requireUser(deps, sessionCookieValue(ctx));
  await requireMember(deps, ctx.params.setId, user.id);
  const number = Number(ctx.params.number);
  if (!Number.isInteger(number)) throw errors.notFound();
  const result = await deps.pool.query('SELECT number, source, sha256 FROM shader_versions WHERE set_id = $1 AND layer_id = $2 AND number = $3', [ctx.params.setId, ctx.params.layerId, number]);
  const row = result.rows[0] as { number: number; source: string; sha256: string } | undefined;
  if (row === undefined) throw errors.notFound();
  jsonOk(ctx, 200, { number: row.number, source: row.source, sha256: row.sha256 });
}

export const shaderRoutes = (deps: ApiDeps): RouteSpec[] => ([
  { method: 'GET', path: '/api/sets/:setId/layers/:layerId/shader/versions', handler: (ctx) => shaderVersions(deps, ctx) },
  { method: 'GET', path: '/api/sets/:setId/layers/:layerId/shader/versions/:number', handler: (ctx) => shaderVersionSource(deps, ctx) },
]);
