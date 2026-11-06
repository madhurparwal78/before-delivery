import { randomBytes } from 'node:crypto';
import type { App, MemberRow } from './api.js';
import type { Ctx } from './http.js';
import { ApiError, fieldErrors, notFound, stateConflict } from './errors.js';
import { str, lengthOf } from './validate.js';
import { hashPassword, verifyPassword } from './schema.js';

const ROLES = ['fleet_director', 'charter_manager', 'finance_lead', 'captain', 'crew_member'] as const;

export function memberToApi(m: { id: string; name: string; email: string; role: string; yacht_slug: string | null }): unknown {
  return { id: m.id, name: m.name, email: m.email, role: m.role, yachtSlug: m.yacht_slug };
}

function homePath(role: string, ws: string): string {
  if (role === 'fleet_director') return `/w/${ws}/fleet`;
  if (role === 'charter_manager') return `/w/${ws}/holds`;
  if (role === 'finance_lead') return `/w/${ws}/charters`;
  return `/w/${ws}/today`;
}

export async function getSession(app: App, ctx: Ctx): Promise<unknown> {
  const state = (ctx as Ctx & { sessionState?: string }).sessionState;
  if (!ctx.session) throw new ApiError(401, { error: 'unauthenticated' });
  if (state === 'ended') throw new ApiError(401, { error: 'session_ended' });
  const rows = await app.pool.query('SELECT m.id, m.workspace_slug, m.name, m.role, w.name AS workspace_name FROM members m JOIN workspaces w ON w.slug = m.workspace_slug WHERE m.id = $1', [ctx.session.memberId]);
  if (rows.rows.length === 0) throw new ApiError(401, { error: 'access_removed' });
  const m = rows.rows[0];
  return {
    member: { id: m.id, name: m.name, role: m.role, workspaceSlug: m.workspace_slug, workspaceName: m.workspace_name },
    homePath: homePath(m.role, m.workspace_slug),
  };
}

export async function postSession(app: App, ctx: Ctx): Promise<unknown> {
  const body = await app.readJsonBody(ctx);
  const errors: Record<string, string> = {};
  const email = str(body.email) ?? '';
  const password = str(body.password) ?? '';
  if (!email) errors.email = 'This field is required.';
  if (!password) errors.password = 'This field is required.';
  if (Object.keys(errors).length > 0) throw fieldErrors(errors);
  const rows = await app.pool.query('SELECT id, workspace_slug, name, email, password_hash, role, yacht_slug FROM members WHERE email = $1', [email]);
  const member = rows.rows[0];
  if (!member || !verifyPassword(password, member.password_hash)) {
    throw new ApiError(401, { error: 'invalid_credentials' });
  }
  const id = 'sess-' + randomBytes(24).toString('base64url');
  await app.pool.query('INSERT INTO sessions (id, member_id, ends_at) VALUES ($1, $2, now() + make_interval(secs => $3))', [id, member.id, app.config.timers.sessionSeconds]);
  ctx.setCookies.push(`tw_session=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${app.config.timers.sessionSeconds}`);
  const wsRow = await app.pool.query('SELECT name FROM workspaces WHERE slug = $1', [member.workspace_slug]);
  return {
    member: { id: member.id, name: member.name, role: member.role, workspaceSlug: member.workspace_slug, workspaceName: wsRow.rows[0].name },
    homePath: homePath(member.role, member.workspace_slug),
  };
}

export async function deleteSession(app: App, ctx: Ctx): Promise<unknown> {
  if (ctx.session) {
    await app.pool.query('UPDATE sessions SET signed_out = true WHERE id = $1', [ctx.session.id]);
  }
  ctx.setCookies.push('tw_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
  return null;
}

export async function membersList(app: App, ctx: Ctx, ws: string): Promise<unknown> {
  await app.requireStaff(ctx, ws, ['fleet_director']);
  const rows = await app.pool.query('SELECT id, name, email, role, yacht_slug FROM members WHERE workspace_slug = $1 ORDER BY name', [ws]);
  return { members: rows.rows.map(memberToApi) };
}

export async function membersCreate(app: App, ctx: Ctx, ws: string): Promise<unknown> {
  const me = await app.requireStaff(ctx, ws, ['fleet_director']);
  void me;
  const body = await app.readJsonBody(ctx);
  const errors: Record<string, string> = {};
  const name = str(body.name) ?? '';
  const email = str(body.email) ?? '';
  const password = str(body.password) ?? '';
  const role = str(body.role) ?? '';
  const yachtSlug = str(body.yachtSlug);
  if (lengthOf(name) < 1 || lengthOf(name) > 80) errors.name = lengthOf(name) < 1 ? 'This field is required.' : 'Use at most 80 characters.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.email = 'Enter an email address like name@example.com.';
  if (password.length < 10) errors.password = 'Use at least 10 characters.';
  if (!ROLES.includes(role as (typeof ROLES)[number])) errors.role = 'Choose one of the listed options.';
  if (role === 'crew_member' && !yachtSlug) errors.yachtSlug = 'Choose a yacht for a crew member.';
  if (yachtSlug) {
    const yacht = await app.pool.query('SELECT 1 FROM yachts WHERE slug = $1 AND workspace_slug = $2', [yachtSlug, ws]);
    if (yacht.rowCount === 0) errors.yachtSlug = 'Choose one of the listed options.';
  }
  if (Object.keys(errors).length > 0) throw fieldErrors(errors);
  const emailTaken = await app.pool.query('SELECT 1 FROM members WHERE email = $1', [email]);
  if (emailTaken.rowCount && emailTaken.rowCount > 0) throw stateConflict('email_in_use');
  const id = 'member-' + randomBytes(10).toString('base64url');
  await app.pool.query('INSERT INTO members (id, workspace_slug, name, email, password_hash, role, yacht_slug) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
    id, ws, name, email, hashPassword(password), role, role === 'crew_member' ? yachtSlug : null,
  ]);
  const rows = await app.pool.query('SELECT id, name, email, role, yacht_slug FROM members WHERE id = $1', [id]);
  return { member: memberToApi(rows.rows[0]) };
}

export async function membersPatch(app: App, ctx: Ctx, ws: string, id: string): Promise<unknown> {
  const me = await app.requireStaff(ctx, ws, ['fleet_director']);
  const body = await app.readJsonBody(ctx);
  const errors: Record<string, string> = {};
  const role = str(body.role) ?? '';
  const yachtSlug = str(body.yachtSlug);
  if (!ROLES.includes(role as (typeof ROLES)[number])) errors.role = 'Choose one of the listed options.';
  if (role === 'crew_member' && !yachtSlug) errors.yachtSlug = 'Choose a yacht for a crew member.';
  if (yachtSlug) {
    const yacht = await app.pool.query('SELECT 1 FROM yachts WHERE slug = $1 AND workspace_slug = $2', [yachtSlug, ws]);
    if (yacht.rowCount === 0) errors.yachtSlug = 'Choose one of the listed options.';
  }
  if (Object.keys(errors).length > 0) throw fieldErrors(errors);
  if (id === me.id) throw stateConflict('cannot_change_self');
  const existing = await app.pool.query('SELECT id FROM members WHERE id = $1 AND workspace_slug = $2', [id, ws]);
  if (existing.rowCount === 0) throw notFound();
  await app.pool.query('UPDATE members SET role = $1, yacht_slug = $2 WHERE id = $3', [role, role === 'crew_member' ? yachtSlug : null, id]);
  const rows = await app.pool.query('SELECT id, name, email, role, yacht_slug FROM members WHERE id = $1', [id]);
  return { member: memberToApi(rows.rows[0]) };
}

export async function membersDelete(app: App, ctx: Ctx, ws: string, id: string): Promise<unknown> {
  const me = await app.requireStaff(ctx, ws, ['fleet_director']);
  if (id === me.id) throw stateConflict('cannot_remove_self');
  const existing = await app.pool.query('SELECT id FROM members WHERE id = $1 AND workspace_slug = $2', [id, ws]);
  if (existing.rowCount === 0) throw notFound();
  await app.pool.query('DELETE FROM members WHERE id = $1', [id]);
  return null;
}
