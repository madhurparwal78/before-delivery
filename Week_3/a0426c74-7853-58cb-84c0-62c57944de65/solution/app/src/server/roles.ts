import * as copy from '../shared/copy.ts';
import { ApiError, fieldError } from '../shared/errors.ts';
import { atLeast, isRole, MINIMUM_ROLE } from '../shared/rules.ts';
import type { Role } from '../shared/types.ts';
import { normalizeUsername, requireUser } from './auth.ts';
import { objectBody, stringField } from './body.ts';
import { db } from './db.ts';
import { hub } from './live.ts';
import { route, type RequestContext } from './router.ts';

/** The folder with its parents, nearest first: the walk that lets a role be inherited unless set on the folder itself. */
const FOLDER_CHAIN = `WITH RECURSIVE chain AS (
  SELECT id, parent_id, 0 AS depth FROM folders WHERE id = $1
  UNION ALL SELECT p.id, p.parent_id, c.depth + 1 FROM folders p JOIN chain c ON p.id = c.parent_id)`;

/** A person's role on a folder: the nearest explicit entry walking up the parents, else null. */
export async function folderRole(username: string, folderId: string): Promise<Role | null> {
  const rows = await db.query<{ role: Role }>(
    `${FOLDER_CHAIN} SELECT r.role FROM chain c JOIN folder_roles r ON r.folder_id = c.id AND r.username = $2 ORDER BY c.depth LIMIT 1`,
    [folderId, username],
  );
  return rows.length === 1 ? rows[0].role : null;
}

export interface DrawingAccess { folderId: string; role: Role }

/** A person's role on a drawing (through its folder), or null when the drawing does not exist for them. */
export async function drawingAccess(username: string, drawingId: string): Promise<DrawingAccess | null> {
  const rows = await db.query<{ folder_id: string; role: Role }>(
    `WITH RECURSIVE chain AS (
       SELECT f.id, f.parent_id, 0 AS depth, d.folder_id FROM folders f JOIN drawings d ON d.folder_id = f.id WHERE d.id = $1
       UNION ALL SELECT p.id, p.parent_id, c.depth + 1, c.folder_id FROM folders p JOIN chain c ON p.id = c.parent_id)
     SELECT c.folder_id, r.role FROM chain c JOIN folder_roles r ON r.folder_id = c.id AND r.username = $2 ORDER BY c.depth LIMIT 1`,
    [drawingId, username],
  );
  return rows.length === 1 ? { folderId: rows[0].folder_id, role: rows[0].role } : null;
}

/** The caller's role on a folder; `not_found` when they have none (a folder without a role does not exist for them). */
export async function roleOnFolder(ctx: RequestContext, folderId: string): Promise<Role> {
  const role = await folderRole(requireUser(ctx).username, folderId);
  if (!role) throw new ApiError('not_found', copy.NOT_FOUND);
  return role;
}

/**
 * The caller's access to a drawing; `not_found` when the drawing is unknown or outside their folders, and, when `minimum` is given,
 * the forbidden family when their role is below it.
 */
export async function roleOnDrawing(ctx: RequestContext, drawingId: string, minimum?: Role): Promise<DrawingAccess> {
  const access = await drawingAccess(requireUser(ctx).username, drawingId);
  if (!access) throw new ApiError('not_found', copy.NOT_FOUND);
  if (minimum !== undefined) requireRole(access.role, minimum);
  return access;
}

/** The forbidden family: `read_only` for an edit by `view` or `markup`, `forbidden` for every other role that is too low. */
export function requireRole(actual: Role, needed: Role): void {
  if (atLeast(actual, needed)) return;
  if (needed === MINIMUM_ROLE.editDrawing) throw new ApiError('read_only', copy.VIEW_ONLY);
  throw new ApiError('forbidden', copy.FORBIDDEN);
}

/** Tells every open drawing page whose role changed, so the new role applies in open sessions at once (Roles). */
async function refreshLiveRoles(): Promise<void> {
  for (const { drawingId, username, role } of hub.connectedPeople()) {
    const now = (await drawingAccess(username, drawingId))?.role ?? null;
    if (now !== role) hub.setRole(drawingId, username, now);
  }
}

route('PUT', '/api/folders/:id/roles/:username', async (ctx) => {
  requireRole(await roleOnFolder(ctx, ctx.params.id), MINIMUM_ROLE.setFolderRole);
  const role = stringField(objectBody(ctx.json()), 'role');
  if (!isRole(role)) throw fieldError('role', copy.ROLE_NAME);
  const target = normalizeUsername(ctx.params.username);
  if ((await db.query('SELECT 1 FROM users WHERE username = $1', [target])).length === 0) throw new ApiError('not_found', copy.NOT_FOUND);
  await db.query(
    `INSERT INTO folder_roles (folder_id, username, role) VALUES ($1, $2, $3)
     ON CONFLICT (folder_id, username) DO UPDATE SET role = EXCLUDED.role`,
    [ctx.params.id, target, role],
  );
  await refreshLiveRoles();
  return ctx.reply(200, { username: target, role, inherited: false });
});

route('DELETE', '/api/folders/:id/roles/:username', async (ctx) => {
  requireRole(await roleOnFolder(ctx, ctx.params.id), MINIMUM_ROLE.setFolderRole);
  await db.query('DELETE FROM folder_roles WHERE folder_id = $1 AND username = $2', [ctx.params.id, normalizeUsername(ctx.params.username)]);
  await refreshLiveRoles();
  return ctx.reply(204);
});

route('GET', '/api/folders/:id/roles', async (ctx) => {
  await roleOnFolder(ctx, ctx.params.id);
  const rows = await db.query<{ username: string; role: Role; depth: number }>(
    `${FOLDER_CHAIN} SELECT DISTINCT ON (r.username COLLATE "C") r.username, r.role, c.depth
       FROM chain c JOIN folder_roles r ON r.folder_id = c.id ORDER BY r.username COLLATE "C", c.depth`,
    [ctx.params.id],
  );
  return ctx.reply(200, { roles: rows.map((row) => ({ username: row.username, role: row.role, inherited: row.depth > 0 })) });
});
