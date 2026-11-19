import { randomUUID } from 'node:crypto';
import {
  clearedSessionCookie,
  createSession,
  destroySession,
  hashPassword,
  requireViewer,
  sessionCookie,
  sessionCookieName,
  verifyPassword,
  type Viewer,
} from '../auth.js';
import { one, query } from '../db.js';
import { errors } from '../errors.js';
import { jsonResponse, noContent, type HttpResponse, type RequestContext } from '../http/context.js';
import type { Router } from '../http/router.js';
import { FieldErrors, asString, checkDisplayName, checkEmail, checkHandle, checkPassword } from '../validate.js';
import { fieldMessages } from '../../shared/fields.js';
import { accountView } from './accounts.js';

async function emailTaken(email: string): Promise<boolean> {
  const row = await one('select 1 as present from accounts where lower(email) = lower($1)', [email]);
  return row !== null;
}

async function handleTaken(handle: string): Promise<boolean> {
  const row = await one('select 1 as present from accounts where handle = $1', [handle]);
  return row !== null;
}

async function viewerById(id: string): Promise<Viewer> {
  const viewer = await one<Viewer>(
    'select id, email, display_name, handle, role, group_id, workspace_id from accounts where id = $1',
    [id],
  );
  if (viewer === null) {
    throw errors.notFound();
  }
  return viewer;
}

async function signIn(context: RequestContext): Promise<HttpResponse> {
  const body = context.body as Record<string, unknown>;
  const fields = new FieldErrors();
  const email = checkEmail(fields, body.email);
  const password = asString(body.password) ?? '';
  if (password === '') {
    fields.add('password', fieldMessages.passwordEmpty);
  }
  fields.throwIfAny();

  const account = await one<Viewer & { password_hash: string }>(
    `select id, email, display_name, handle, role, group_id, workspace_id, password_hash
       from accounts where lower(email) = lower($1)`,
    [email],
  );
  if (account === null || !(await verifyPassword(password, account.password_hash))) {
    throw errors.invalidCredentials();
  }
  const token = await createSession(account.id);
  return jsonResponse(200, await accountView(account), { 'Set-Cookie': sessionCookie(token) });
}

async function signOut(context: RequestContext): Promise<HttpResponse> {
  await requireViewer(context);
  const token = context.cookies[sessionCookieName];
  if (token) {
    await destroySession(token);
  }
  return noContent({ 'Set-Cookie': clearedSessionCookie() });
}

async function signUp(context: RequestContext): Promise<HttpResponse> {
  const body = context.body as Record<string, unknown>;
  const fields = new FieldErrors();
  const email = checkEmail(fields, body.email);
  const displayName = checkDisplayName(fields, body.displayName);
  const handle = checkHandle(fields, body.handle);
  const password = checkPassword(fields, body.password);
  if (fields.isEmpty) {
    if (await emailTaken(email)) {
      fields.add('email', fieldMessages.emailTaken);
    }
    if (await handleTaken(handle)) {
      fields.add('handle', fieldMessages.handleTaken);
    }
  }
  fields.throwIfAny();

  const id = randomUUID();
  await query(
    `insert into accounts (id, email, display_name, handle, role, password_hash)
          values ($1, $2, $3, $4, 'follower', $5)`,
    [id, email, displayName, handle, await hashPassword(password)],
  );
  const token = await createSession(id);
  return jsonResponse(201, await accountView(await viewerById(id)), { 'Set-Cookie': sessionCookie(token) });
}

async function me(context: RequestContext): Promise<HttpResponse> {
  return jsonResponse(200, await accountView(await requireViewer(context)));
}

interface InviteRow {
  id: string;
  workspace_id: string;
  email: string;
  display_name: string;
  used_at: Date | null;
  workspace_name: string;
}

async function inviteByToken(token: string): Promise<InviteRow | null> {
  return one<InviteRow>(
    `select i.id, i.workspace_id, i.email, i.display_name, i.used_at, w.name as workspace_name
       from invites i join workspaces w on w.id = i.workspace_id
      where i.token = $1`,
    [token],
  );
}

async function inviteUsed(invite: InviteRow): Promise<boolean> {
  return invite.used_at !== null || (await emailTaken(invite.email));
}

async function readInvite(context: RequestContext): Promise<HttpResponse> {
  const invite = await inviteByToken(context.params.token);
  if (invite === null) {
    throw errors.notFound();
  }
  if (await inviteUsed(invite)) {
    throw errors.inviteUsed();
  }
  return jsonResponse(200, {
    workspaceName: invite.workspace_name,
    email: invite.email,
    displayName: invite.display_name,
  });
}

async function acceptInvite(context: RequestContext): Promise<HttpResponse> {
  const invite = await inviteByToken(context.params.token);
  if (invite === null) {
    throw errors.notFound();
  }
  if (await inviteUsed(invite)) {
    throw errors.inviteUsed();
  }
  const body = context.body as Record<string, unknown>;
  const fields = new FieldErrors();
  const handle = checkHandle(fields, body.handle);
  const password = checkPassword(fields, body.password);
  if (fields.isEmpty && (await handleTaken(handle))) {
    fields.add('handle', fieldMessages.handleTaken);
  }
  fields.throwIfAny();

  const id = randomUUID();
  await query(
    `insert into accounts (id, email, display_name, handle, role, password_hash, workspace_id)
          values ($1, $2, $3, $4, 'designer', $5, $6)`,
    [id, invite.email, invite.display_name, handle, await hashPassword(password), invite.workspace_id],
  );
  await query('update invites set used_at = now() where lower(email) = lower($1) and used_at is null', [invite.email]);
  const token = await createSession(id);
  return jsonResponse(201, await accountView(await viewerById(id)), { 'Set-Cookie': sessionCookie(token) });
}

export function registerAuthRoutes(router: Router): void {
  router.get('/api/health', async () => jsonResponse(200, { status: 'ok' }));
  router.post('/api/auth/signin', 'json', signIn);
  router.post('/api/auth/signout', 'none', signOut);
  router.post('/api/auth/signup', 'json', signUp);
  router.get('/api/me', me);
  router.get('/api/invites/:token', readInvite);
  router.post('/api/invites/:token/accept', 'json', acceptInvite);
}
