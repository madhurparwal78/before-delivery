import { query } from '../db.js';
import { errors } from './errors.js';
import { jsonOk, parseJsonBody, requireJsonContentType, type Ctx } from './http.js';
import { resolveWorkspace } from './auth.js';
import { formatInstant, isStr, codePoints, invalid } from './helpers.js';
import { hashPassword, newToken } from '../domain/crypto.js';

const ROLES = ['compliance_officer', 'compliance_analyst', 'operations_lead', 'finance_lead', 'support_agent'];

export async function listMembers(ctx: Ctx): Promise<Response> {
  const ws = await resolveWorkspace(ctx);
  const r = await query<{ id: string; name: string; email: string; role: string; created_at: Date }>('SELECT id, name, email, role, created_at FROM members WHERE workspace_slug = $1 ORDER BY created_at, id', [ws.slug]);
  return jsonOk({ members: r.rows.map((m) => ({ id: m.id, name: m.name, email: m.email, role: m.role, createdAt: formatInstant(m.created_at) })) });
}

export async function getMember(ctx: Ctx): Promise<Response> {
  await resolveWorkspace(ctx);
  const r = await query<{ id: string; name: string; email: string; role: string; created_at: Date }>('SELECT id, name, email, role, created_at FROM members WHERE id = $1 AND workspace_slug = $2', [ctx.params.id, ctx.params.slug]);
  if (r.rows.length === 0) throw errors.notFound();
  const m = r.rows[0];
  return jsonOk({ member: { id: m.id, name: m.name, email: m.email, role: m.role, createdAt: formatInstant(m.created_at) } });
}

function validateMemberBody(body: Record<string, unknown>): { name: string; email: string; role: string; password: string } | never {
  const fields: Record<string, string> = {};
  const name = isStr(body.name) ? body.name : '';
  const email = isStr(body.email) ? body.email : '';
  const role = isStr(body.role) ? body.role : '';
  const password = isStr(body.password) ? body.password : '';
  if (codePoints(name) < 1 || codePoints(name) > 120) fields.name = 'Enter a name.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fields.email = 'Enter an email address.';
  if (!ROLES.includes(role)) fields.role = 'Choose a role.';
  if (password.length < 12) fields.password = 'Choose a password of at least 12 characters.';
  if (Object.keys(fields).length > 0) invalid(fields);
  return { name, email, role, password };
}

export async function createMember(ctx: Ctx): Promise<Response> {
  const ws = await resolveWorkspace(ctx);
  requireJsonContentType(ctx, ['application/json']);
  const body = parseJsonBody(await ctx.rawBody());
  const member = validateMemberBody(body);
  const existing = await query('SELECT 1 FROM members WHERE lower(email) = lower($1)', [member.email]);
  if (existing.rows.length > 0) throw errors.conflict('email_taken', 'This email already belongs to a member.');
  const id = `mem-${newToken(8).toLowerCase()}`;
  const now = new Date();
  await query('INSERT INTO members (id, workspace_slug, name, email, role, password_hash, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, ws.slug, member.name, member.email, member.role, hashPassword(member.password), now]);
  return jsonOk({ member: { id, name: member.name, email: member.email, role: member.role, createdAt: formatInstant(now) } }, 201);
}

export async function updateMember(ctx: Ctx): Promise<Response> {
  await resolveWorkspace(ctx);
  requireJsonContentType(ctx, ['application/json']);
  const body = parseJsonBody(await ctx.rawBody());
  if (ctx.session === null) throw errors.unauthenticated();
  const r = await query<{ id: string; name: string; email: string; role: string; created_at: Date }>('SELECT id, name, email, role, created_at FROM members WHERE id = $1 AND workspace_slug = $2', [ctx.params.id, ctx.params.slug]);
  if (r.rows.length === 0) throw errors.notFound();
  if (r.rows[0].id === ctx.session.memberId) throw errors.conflict('own_membership', "You can't change or remove your own membership.");
  const role = isStr(body.role) ? body.role : '';
  if (!ROLES.includes(role)) invalid({ role: 'Choose a role.' });
  await query('UPDATE members SET role = $1 WHERE id = $2', [role, r.rows[0].id]);
  return jsonOk({ member: { id: r.rows[0].id, name: r.rows[0].name, email: r.rows[0].email, role, createdAt: formatInstant(r.rows[0].created_at) } });
}

export async function removeMember(ctx: Ctx): Promise<Response> {
  await resolveWorkspace(ctx);
  const r = await query('SELECT id FROM members WHERE id = $1 AND workspace_slug = $2', [ctx.params.id, ctx.params.slug]);
  if (r.rows.length === 0) throw errors.notFound();
  if (ctx.session !== null && r.rows[0].id === ctx.session.memberId) throw errors.conflict('own_membership', "You can't change or remove your own membership.");
  await query('UPDATE sessions SET ended = true, end_reason = $2 WHERE member_id = $1', [r.rows[0].id, 'access_removed']);
  await query('DELETE FROM members WHERE id = $1', [r.rows[0].id]);
  return new Response(null, { status: 204 });
}
