import { query } from '../db.js';
import { errors } from './errors.js';
import { jsonOk, parseJsonBody, requireJsonContentType, type Ctx } from './http.js';
import { SESSION_COOKIE, newSessionCookie, clearSessionCookie } from './cookies.js';
import { verifyPassword } from '../domain/crypto.js';

export async function createSession(ctx: Ctx): Promise<Response> {
  requireJsonContentType(ctx, ['application/json']);
  const body = parseJsonBody(await ctx.rawBody());
  const email = typeof body.email === 'string' ? body.email : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (email === '' || password === '') throw errors.signInFailed();
  const r = await query<{ id: string; workspace_slug: string; name: string; email: string; role: string; password_hash: string }>(
    'SELECT id, workspace_slug, name, email, role, password_hash FROM members WHERE lower(email) = lower($1)',
    [email],
  );
  if (r.rows.length === 0) throw errors.signInFailed();
  const member = r.rows[0];
  if (!verifyPassword(password, member.password_hash)) throw errors.signInFailed();
  const { newSessionId } = await import('../domain/crypto.js');
  const id = newSessionId();
  const expiresAt = new Date(Date.now() + (await import('../config.js')).config.sessionSeconds * 1000);
  await query('INSERT INTO sessions (id, member_id, workspace_slug, expires_at) VALUES ($1,$2,$3,$4)', [id, member.id, member.workspace_slug, expiresAt]);
  const ws = await query<{ slug: string; name: string }>('SELECT slug, name FROM workspaces WHERE slug = $1', [member.workspace_slug]);
  const home = member.role === 'finance_lead' ? `/w/${member.workspace_slug}/months` : `/w/${member.workspace_slug}/cases`;
  ctx.setCookie(newSessionCookie(id));
  return jsonOk({ member: { id: member.id, name: member.name, email: member.email, role: member.role }, workspace: { slug: ws.rows[0].slug, name: ws.rows[0].name }, home }, 200);
}

export async function getSession(ctx: Ctx): Promise<Response> {
  if (ctx.session === null) throw errors.unauthenticated();
  const member = ctx.session;
  const home = member.role === 'finance_lead' ? `/w/${member.workspaceSlug}/months` : `/w/${member.workspaceSlug}/cases`;
  const ws = await query<{ slug: string; name: string }>('SELECT slug, name FROM workspaces WHERE slug = $1', [member.workspaceSlug]);
  return jsonOk({ member: { id: member.memberId, name: member.name, email: member.email, role: member.role }, workspace: { slug: ws.rows[0].slug, name: ws.rows[0].name }, home });
}

export async function deleteSession(ctx: Ctx): Promise<Response> {
  if (ctx.session === null) throw errors.unauthenticated();
  await query('DELETE FROM sessions WHERE id = $1', [ctx.cookies[SESSION_COOKIE]]);
  ctx.setCookie(clearSessionCookie());
  return new Response(null, { status: 204 });
}
