import { SESSION_COOKIE } from '../config';
import { one, query } from '../db';
import { ApiError, badRequest, messages, notFound } from '../errors';
import { MailUnavailable, mailTexts, sendMail } from '../mail';
import { emailLooksValid, hashPassword, hex, newId, passwordMatches, slugify, token } from '../util';
import { checkName, cookies, type Ctx, type Reply, type Route, type UserRow } from '../http';
import type { Role } from '../../shared/types';

export function cookieHeader(value: string | null): string {
  if (value === null) return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
  return `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/`;
}

export async function createSession(userId: string): Promise<string> {
  const id = token();
  await query('insert into sessions (id, user_id) values ($1, $2)', [id, userId]);
  return id;
}

export async function firstWorkspaceId(userId: string): Promise<string | null> {
  const row = await one<{ workspace_id: string }>(
    'select workspace_id from members where user_id = $1 order by joined_at, workspace_id limit 1',
    [userId],
  );
  return row === null ? null : row.workspace_id;
}

async function uniqueSlug(base: string): Promise<string> {
  for (let attempt = 0; ; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const taken = await one('select id from workspaces where slug = $1', [candidate]);
    if (taken === null) return candidate;
  }
}

export async function createWorkspace(name: string, id?: string, slug?: string): Promise<string> {
  const workspaceId = id ?? newId('ws');
  await query('insert into workspaces (id, name, slug) values ($1, $2, $3)', [
    workspaceId,
    name,
    slug ?? (await uniqueSlug(slugify(name))),
  ]);
  return workspaceId;
}

export async function addMember(workspaceId: string, userId: string, role: Role): Promise<void> {
  await query(
    `insert into members (workspace_id, user_id, role) values ($1, $2, $3)
       on conflict (workspace_id, user_id) do update set role = $3`,
    [workspaceId, userId, role],
  );
}

export async function createUser(
  name: string,
  email: string,
  password: string,
  confirmed: boolean,
  confirmToken: string | null,
): Promise<string> {
  const id = `user-${hex(6)}`;
  await query(
    'insert into users (id, name, email, password_hash, confirmed, confirm_token) values ($1, $2, $3, $4, $5, $6)',
    [id, name, email.trim(), hashPassword(password), confirmed, confirmToken],
  );
  return id;
}

function validateSignUp(name: unknown, email: unknown, password: unknown): void {
  if (typeof name !== 'string' || name.trim() === '') throw badRequest(messages.enterName, { field: 'name' });
  if (!emailLooksValid(email)) throw badRequest(messages.enterEmail, { field: 'email' });
  if (typeof password !== 'string' || password.length < 8) {
    throw badRequest(messages.shortPassword, { field: 'password' });
  }
}

async function signUp(ctx: Ctx): Promise<Reply> {
  const { name, email, password } = ctx.body;
  checkName(name);
  const emailText = typeof email === 'string' ? email.trim() : '';
  if (emailText !== '') {
    const existing = await one('select id from users where lower(email) = lower($1)', [emailText]);
    if (existing !== null) throw new ApiError(409, messages.emailTaken);
  }
  validateSignUp(name, email, password);
  const userName = (name as string).trim();
  const confirmToken = token();
  try {
    await sendMail({
      to: emailText,
      subject: mailTexts.confirmSubject,
      text: mailTexts.confirmBody(userName, confirmToken),
    });
  } catch (error) {
    if (error instanceof MailUnavailable) throw new ApiError(503, messages.mailUnavailable);
    throw error;
  }
  const userId = await createUser(userName, emailText, password as string, false, confirmToken);
  const workspaceId = await createWorkspace(`${userName}'s workspace`);
  await addMember(workspaceId, userId, 'owner');
  return { status: 201, json: { message: 'Check your email to confirm your account' } };
}

async function confirm(ctx: Ctx): Promise<Reply> {
  const user = await one<UserRow>('select * from users where confirm_token = $1 and confirmed = false', [
    typeof ctx.body.token === 'string' ? ctx.body.token : '',
  ]);
  if (user === null) throw notFound();
  await query('update users set confirmed = true, confirm_token = null where id = $1', [user.id]);
  const session = await createSession(user.id);
  const workspaceId = await firstWorkspaceId(user.id);
  return {
    status: 200,
    json: { workspace_id: workspaceId },
    headers: { 'set-cookie': cookieHeader(session) },
  };
}

async function signIn(ctx: Ctx): Promise<Reply> {
  const email = typeof ctx.body.email === 'string' ? ctx.body.email.trim() : '';
  const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
  const user = await one<UserRow>('select * from users where lower(email) = lower($1)', [email]);
  if (user === null || !passwordMatches(password, user.password_hash)) {
    throw new ApiError(401, messages.wrongCredentials);
  }
  if (!user.confirmed) throw new ApiError(403, messages.confirmFirst);
  const session = await createSession(user.id);
  const workspaceId = await firstWorkspaceId(user.id);
  return {
    status: 200,
    json: { workspace_id: workspaceId, name: user.name },
    headers: { 'set-cookie': cookieHeader(session) },
  };
}

async function signOut(ctx: Ctx): Promise<Reply> {
  const sessionId = cookies(ctx.req)[SESSION_COOKIE];
  if (sessionId !== undefined) await query('delete from sessions where id = $1', [sessionId]);
  return { status: 204, headers: { 'set-cookie': cookieHeader(null) } };
}

async function me(ctx: Ctx): Promise<Reply> {
  const workspaces = await query<{ id: string; name: string; slug: string; role: Role }>(
    `select w.id, w.name, w.slug, m.role from members m join workspaces w on w.id = m.workspace_id
       where m.user_id = $1 order by m.joined_at, w.id`,
    [ctx.user.id],
  );
  return {
    status: 200,
    json: { id: ctx.user.id, name: ctx.user.name, email: ctx.user.email, workspaces },
  };
}

interface InviteRow {
  id: string;
  workspace_id: string;
  email: string;
  role: Role;
  token: string;
  used: boolean;
  inviter_name: string;
}

async function inviteByToken(value: string): Promise<InviteRow> {
  const invite = await one<InviteRow>('select * from invites where token = $1 and used = false', [value]);
  if (invite === null) throw notFound();
  return invite;
}

async function readInvite(ctx: Ctx): Promise<Reply> {
  const invite = await inviteByToken(ctx.params.token);
  const workspace = await one<{ name: string }>('select name from workspaces where id = $1', [invite.workspace_id]);
  const account = await one('select id from users where lower(email) = lower($1)', [invite.email]);
  return {
    status: 200,
    json: {
      workspace_name: workspace === null ? '' : workspace.name,
      email: invite.email,
      role: invite.role,
      has_account: account !== null,
    },
  };
}

async function acceptInvite(ctx: Ctx): Promise<Reply> {
  const invite = await inviteByToken(ctx.params.token);
  const existing = await one<UserRow>('select * from users where lower(email) = lower($1)', [invite.email]);
  let userId: string;
  if (existing === null) {
    checkName(ctx.body.name);
    validateSignUp(ctx.body.name, invite.email, ctx.body.password);
    userId = await createUser(
      (ctx.body.name as string).trim(),
      invite.email,
      ctx.body.password as string,
      true,
      null,
    );
  } else {
    const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
    if (!passwordMatches(password, existing.password_hash)) throw new ApiError(401, messages.wrongCredentials);
    userId = existing.id;
  }
  await addMember(invite.workspace_id, userId, invite.role);
  await query('update invites set used = true where id = $1', [invite.id]);
  const session = await createSession(userId);
  return {
    status: 200,
    json: { workspace_id: invite.workspace_id },
    headers: { 'set-cookie': cookieHeader(session) },
  };
}

export const authRoutes: Route[] = [
  { method: 'POST', path: '/api/auth/sign-up', body: 'json', handler: signUp },
  { method: 'POST', path: '/api/auth/confirm', body: 'json', handler: confirm },
  { method: 'POST', path: '/api/auth/sign-in', body: 'json', handler: signIn },
  { method: 'POST', path: '/api/auth/sign-out', body: 'json', handler: signOut },
  { method: 'GET', path: '/api/me', auth: 'session', handler: me },
  { method: 'GET', path: '/api/invites/:token', handler: readInvite },
  { method: 'POST', path: '/api/invites/:token/accept', body: 'json', handler: acceptInvite },
];
