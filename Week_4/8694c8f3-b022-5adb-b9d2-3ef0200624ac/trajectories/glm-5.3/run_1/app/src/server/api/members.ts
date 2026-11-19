import { errors } from '../errors.js';
import { newToken } from '../crypto.js';
import { requireMember, requireUser, requireOwner } from '../access.js';
import { jsonOk, readBody } from './api.js';
import type { ApiDeps, RouteSpec } from './api.js';
import type { RequestCtx } from '../router.js';
import { sessionCookieValue } from './auth.js';
import { withTransaction } from '../db.js';
import { writeActivityRecord } from './activity.js';

export async function listMembers (deps: ApiDeps, ctx: RequestCtx): Promise<void> {
  const user = await requireUser(deps, sessionCookieValue(ctx));
  await requireMember(deps, ctx.params.setId, user.id);
  const result = await deps.pool.query(
    'SELECT m.user_id, u.display_name, u.email, m.role FROM members m JOIN users u ON u.id = m.user_id WHERE m.set_id = $1 ORDER BY m.joined_at',
    [ctx.params.setId],
  );
  jsonOk(ctx, 200, { members: result.rows });
}

export async function createInvite (deps: ApiDeps, ctx: RequestCtx): Promise<void> {
  const user = await requireUser(deps, sessionCookieValue(ctx));
  const role = await requireMember(deps, ctx.params.setId, user.id);
  requireOwner(role);
  const body = await readBody<{ role?: unknown }>(ctx, 1_000_000);
  if (body.role !== 'editor' && body.role !== 'viewer') throw errors.validation({ role: 'Role must be editor or viewer' });
  const token = newToken();
  await deps.pool.query('INSERT INTO invites (token, set_id, role) VALUES ($1,$2,$3)', [token, ctx.params.setId, body.role]);
  jsonOk(ctx, 201, { token, url: `/join/${token}`, role: body.role });
}

export async function getInvite (deps: ApiDeps, ctx: RequestCtx): Promise<void> {
  await requireUser(deps, sessionCookieValue(ctx));
  const result = await deps.pool.query(
    `SELECT i.role, i.used_by, s.name AS set_name, u.display_name AS owner_name
       FROM invites i JOIN sets s ON s.id = i.set_id JOIN members m ON m.set_id = i.set_id AND m.role = 'owner' JOIN users u ON u.id = m.user_id
      WHERE i.token = $1`,
    [ctx.params.token],
  );
  const row = result.rows[0] as { role: string; used_by: string | null; set_name: string; owner_name: string } | undefined;
  if (row === undefined) throw errors.notFound();
  jsonOk(ctx, 200, { set_name: row.set_name, role: row.role, owner_display_name: row.owner_name, used: row.used_by !== null });
}

export async function acceptInvite (deps: ApiDeps, ctx: RequestCtx): Promise<void> {
  const user = await requireUser(deps, sessionCookieValue(ctx));
  const result = await deps.pool.query('SELECT * FROM invites WHERE token = $1', [ctx.params.token]);
  const row = result.rows[0] as { token: string; set_id: string; role: string; used_by: string | null } | undefined;
  if (row === undefined) throw errors.notFound();
  const existingRole = await deps.pool.query('SELECT role FROM members WHERE set_id = $1 AND user_id = $2', [row.set_id, user.id]);
  if ((existingRole.rowCount ?? 0) > 0) {
    jsonOk(ctx, 200, { set_id: row.set_id, role: (existingRole.rows[0] as { role: string }).role });
    return;
  }
  if (row.used_by !== null && row.used_by !== user.id) throw errors.inviteUsed();
  await withTransaction(deps.pool, async (client) => {
    await client.query('INSERT INTO members (set_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT (set_id, user_id) DO UPDATE SET role = $3', [row.set_id, user.id, row.role]);
    await client.query('UPDATE invites SET used_by = $1, used_at = now() WHERE token = $2', [user.id, row.token]);
  });
  await writeActivityRecord(deps, row.set_id, user.id, 'member.join', user.id, `${user.display_name} joined as ${row.role}`);
  jsonOk(ctx, 200, { set_id: row.set_id, role: row.role });
}

export const memberRoutes = (deps: ApiDeps): RouteSpec[] => ([
  { method: 'GET', path: '/api/sets/:setId/members', handler: (ctx) => listMembers(deps, ctx) },
  { method: 'POST', path: '/api/sets/:setId/invites', handler: (ctx) => createInvite(deps, ctx) },
  { method: 'GET', path: '/api/invites/:token', handler: (ctx) => getInvite(deps, ctx) },
  { method: 'POST', path: '/api/invites/:token/accept', handler: (ctx) => acceptInvite(deps, ctx) },
]);
