import { one, query } from '../db.js';
import { newId, verifyPassword } from '../domain/ids.js';
import { personView } from '../domain/shapes.js';
import { templates } from '../domain/templates.js';
import { allowedKeys, checkDisplayName, normaliseEmail } from '../domain/validation.js';
import { Ctx, Reply, requireUser, SESSION_COOKIE, SessionUser } from '../http/context.js';
import { ApiError } from '../http/errors.js';
import { Route } from '../http/router.js';

export function sessionCookie(id: string): string {
  return `${SESSION_COOKIE}=${id}; HttpOnly; SameSite=Lax; Path=/`;
}

function clearedCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export async function startSession(userId: string): Promise<string> {
  const id = newId('sess');
  await query(`insert into sessions (id, user_id) values ($1, $2)`, [id, userId]);
  return id;
}

async function signIn(ctx: Ctx): Promise<Reply> {
  const email = ctx.body.email;
  const password = ctx.body.password;
  if (typeof email !== 'string' || typeof password !== 'string') {
    throw new ApiError(401, 'invalid_credentials');
  }
  const user = await one<SessionUser>(`select * from users where email_lower = $1`, [
    normaliseEmail(email),
  ]);
  if (user === null || !verifyPassword(password, user.password_hash)) {
    throw new ApiError(401, 'invalid_credentials');
  }
  allowedKeys(ctx.body, ['email', 'password']);
  const sessionId = await startSession(user.id);
  return {
    status: 200,
    body: { user: personView.user(user) },
    headers: { 'Set-Cookie': sessionCookie(sessionId) },
  };
}

async function signOut(ctx: Ctx): Promise<Reply> {
  requireUser(ctx);
  await query(`delete from sessions where id = $1`, [ctx.sessionId]);
  return { status: 204, headers: { 'Set-Cookie': clearedCookie() } };
}

async function readMe(ctx: Ctx): Promise<Reply> {
  const user = requireUser(ctx);
  const workspace = await one<{ id: string; name: string; role: string }>(
    `select w.id, w.name, m.role from workspaces w
       join workspace_members m on m.workspace_id = w.id
      where m.user_id = $1`,
    [user.id],
  );
  return { status: 200, body: { user: personView.user(user), workspace } };
}

async function updateMe(ctx: Ctx): Promise<Reply> {
  const user = requireUser(ctx);
  allowedKeys(ctx.body, ['displayName']);
  const displayName = checkDisplayName(ctx.body);
  const updated = await one<SessionUser>(
    `update users set display_name = $2 where id = $1 returning *`,
    [user.id, displayName],
  );
  return { status: 200, body: { user: personView.user(updated as SessionUser) } };
}

async function listTemplates(ctx: Ctx): Promise<Reply> {
  requireUser(ctx);
  return {
    status: 200,
    body: { templates: templates.map((template) => ({ id: template.id, name: template.name })) },
  };
}

async function health(): Promise<Reply> {
  return { status: 200, body: { status: 'ok' } };
}

export const sessionRoutes: Route[] = [
  { method: 'POST', path: '/api/session', keys: ['email', 'password'], anonymous: true, handler: signIn },
  { method: 'DELETE', path: '/api/session', keys: [], handler: signOut },
  { method: 'GET', path: '/api/me', keys: [], handler: readMe },
  { method: 'PATCH', path: '/api/me', keys: ['displayName'], handler: updateMe },
  { method: 'GET', path: '/api/templates', keys: [], handler: listTemplates },
  { method: 'GET', path: '/api/health', keys: [], anonymous: true, handler: health },
];
