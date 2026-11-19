import { queryOne } from '../db';
import { ApiError, FieldErrors, notFound } from '../errors';
import { FIELD_COPY } from '../../shared/copy';
import { hashPassword, verifyPassword } from '../passwords';
import { createSession, clearedCookie, revokeSession, sessionCookie } from '../domain/sessions';
import { projectUser, type UserRow } from '../domain/users';
import { nowDate } from '../clock';
import { query } from '../db';
import type { Route } from '../http/router';
import { readJsonBody, requireUser, sendJson, sendNoContent, type RequestContext } from '../http/context';
import type { Workspace } from '../../shared/api';

async function workspaceOf(workspaceId: string): Promise<Workspace> {
  const row = await queryOne<Workspace>('SELECT id, name, time_zone FROM workspaces WHERE id = $1', [workspaceId]);
  if (row === null) throw notFound();
  return row;
}

async function signIn(ctx: RequestContext): Promise<void> {
  const body = await readJsonBody(ctx);
  const errors = new FieldErrors();
  const email = typeof body['email'] === 'string' ? (body['email'] as string).trim() : '';
  const password = typeof body['password'] === 'string' ? (body['password'] as string) : '';
  if (email.length === 0) errors.add('email', FIELD_COPY.email);
  if (password.length === 0) errors.add('password', FIELD_COPY.passwordSignIn);
  errors.throwIfAny();

  const row = await queryOne<UserRow & { password_hash: string | null }>(
    'SELECT id, workspace_id, name, handle, email, role, status, password_hash FROM users WHERE lower(email) = lower($1)',
    [email],
  );
  if (row === null || row.status !== 'active' || !(await verifyPassword(password, row.password_hash))) {
    throw new ApiError('invalid_credentials');
  }
  const token = await createSession(row.id);
  sendJson(
    ctx,
    200,
    { user: projectUser(row, { id: row.id, workspaceId: row.workspace_id, role: row.role }), workspace: await workspaceOf(row.workspace_id) },
    { 'set-cookie': sessionCookie(token) },
  );
}

async function signOut(ctx: RequestContext): Promise<void> {
  if (ctx.user !== null) await revokeSession(ctx.user.token);
  ctx.res.setHeader('set-cookie', clearedCookie());
  sendNoContent(ctx);
}

async function me(ctx: RequestContext): Promise<void> {
  const user = requireUser(ctx);
  sendJson(ctx, 200, {
    user: projectUser(user, { id: user.id, workspaceId: user.workspace_id, role: user.role }),
    workspace: await workspaceOf(user.workspace_id),
  });
}

async function viewInvite(ctx: RequestContext): Promise<void> {
  const row = await queryOne<{ workspace_name: string; name: string; email: string }>(
    `SELECT w.name AS workspace_name, u.name, u.email
     FROM invites i JOIN users u ON u.id = i.user_id JOIN workspaces w ON w.id = i.workspace_id
     WHERE i.token = $1 AND i.accepted_at IS NULL`,
    [ctx.params['token']],
  );
  if (row === null) throw notFound();
  sendJson(ctx, 200, { workspace_name: row.workspace_name, name: row.name, email: row.email });
}

async function acceptInvite(ctx: RequestContext): Promise<void> {
  const token = ctx.params['token'] as string;
  const invite = await queryOne<{ user_id: string }>(
    'SELECT user_id FROM invites WHERE token = $1 AND accepted_at IS NULL',
    [token],
  );
  if (invite === null) throw notFound();

  const body = await readJsonBody(ctx);
  const errors = new FieldErrors();
  const password = typeof body['password'] === 'string' ? (body['password'] as string) : '';
  if (password.length < 12 || password.length > 128) errors.add('password', FIELD_COPY.passwordJoin);
  errors.throwIfAny();

  const claimed = await query<{ token: string }>(
    'UPDATE invites SET accepted_at = $2 WHERE token = $1 AND accepted_at IS NULL RETURNING token',
    [token, nowDate()],
  );
  if (claimed.length === 0) throw notFound();

  await query("UPDATE users SET password_hash = $2, status = 'active' WHERE id = $1", [
    invite.user_id,
    await hashPassword(password),
  ]);
  const row = await queryOne<UserRow>(
    'SELECT id, workspace_id, name, handle, email, role, status FROM users WHERE id = $1',
    [invite.user_id],
  );
  if (row === null) throw notFound();
  const sessionToken = await createSession(row.id);
  sendJson(
    ctx,
    200,
    {
      user: projectUser(row, { id: row.id, workspaceId: row.workspace_id, role: row.role }),
      workspace: await workspaceOf(row.workspace_id),
    },
    { 'set-cookie': sessionCookie(sessionToken) },
  );
}

export const sessionRoutes: Route[] = [
  { method: 'POST', pattern: '/api/session', handler: signIn, anonymous: true },
  { method: 'DELETE', pattern: '/api/session', handler: signOut, anonymous: true },
  { method: 'GET', pattern: '/api/me', handler: me },
  { method: 'GET', pattern: '/api/invites/:token', handler: viewInvite, anonymous: true },
  { method: 'POST', pattern: '/api/invites/:token/accept', handler: acceptInvite, anonymous: true },
];
