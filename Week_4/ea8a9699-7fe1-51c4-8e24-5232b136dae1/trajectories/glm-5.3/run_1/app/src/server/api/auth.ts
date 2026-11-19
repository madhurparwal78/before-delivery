// Auth endpoints and the invite flow.

import http from 'node:http';
import type { URL } from 'node:url';
import type { App, Ctx, Handler } from '../app.js';
import { sendJson, readJsonBody } from '../http-helpers.js';
import { setSessionCookie, clearSessionCookie } from '../http-helpers.js';
import { one, many } from '../db.js';
import { E } from '../e.js';
import { hashPassword, verifyPassword, newToken, newId } from '../passwords.js';
import { validEmail, passwordForNewAccount, passwordForSignIn, validHandle, nameField, type FieldErrors } from '../validate.js';
import { accountView } from '../projections.js';
import type { AccountRow, WorkspaceRow } from '../projections.js';

export function authRoutes(method: string, pathname: string): Handler | null {
  if (method === 'POST' && pathname === '/api/auth/signin') return signin;
  if (method === 'POST' && pathname === '/api/auth/signout') return signout;
  if (method === 'POST' && pathname === '/api/auth/signup') return signup;
  if (method === 'GET' && pathname === '/api/me') return me;
  const inviteGet = /^\/api\/invites\/([^/]+)$/.exec(pathname);
  if (method === 'GET' && inviteGet) {
    const token = inviteGet[1]!;
    return (app, req, res, ctx, url) => inviteInfo(token, app, req, res, ctx, url);
  }
  const invitePost = /^\/api\/invites\/([^/]+)\/accept$/.exec(pathname);
  if (method === 'POST' && invitePost) {
    const token = invitePost[1]!;
    return (app, req, res, ctx, url) => inviteAccept(token, app, req, res, ctx, url);
  }
  return null;
}

async function accountResponse(app: App, res: http.ServerResponse, row: AccountRow): Promise<void> {
  const workspaces = await many<WorkspaceRow & { has_seat: boolean }>(
    app.db,
    `select w.*, ($1::uuid is not null and a.workspace_id = w.id and a.has_seat) as has_seat
       from workspaces w
       left join accounts a on a.id = $1
      where ($1::uuid is not null and a.role = 'ops_lead' and w.group_id = a.group_id)
         or ($1::uuid is not null and a.role = 'designer' and w.id = a.workspace_id)
      order by w.position`,
    [row.id],
  );
  sendJson(res, 200, accountView(row, workspaces.map((w) => ({ slug: w.slug, name: w.name, timeZone: w.time_zone, hasSeat: w.has_seat }))));
}

export { accountResponse };

async function signin(app: App, req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx): Promise<void> {
  const body = await readJsonBody(req);
  const errors: FieldErrors = {};
  const email = validEmail(body.email, errors).toLowerCase();
  const password = passwordForSignIn(body.password, errors);
  if (Object.keys(errors).length > 0) throw E.validation(errors);
  const row = await one<AccountRow & { password_hash: string }>(ctx.db, `select * from accounts where lower(email) = $1`, [email]);
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw E.invalidCredentials();
  }
  const token = newToken('sess');
  await ctx.db.query(`insert into sessions (token, account_id) values ($1,$2)`, [token, row.id]);
  setSessionCookie(res, token);
  await accountResponse(app, res, row);
}

async function signout(_app: App, req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx): Promise<void> {
  if (!ctx.account) throw E.unauthenticated();
  const cookies = req.headers.cookie ?? '';
  const m = /(?:^|;\s*)rushes_session=([^;]+)/.exec(cookies);
  if (m) {
    await ctx.db.query(`delete from sessions where token = $1`, [decodeURIComponent(m[1]!)]);
  }
  clearSessionCookie(res);
  res.statusCode = 204;
  res.end();
}

async function signup(app: App, req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx): Promise<void> {
  const body = await readJsonBody(req);
  const errors: FieldErrors = {};
  const email = validEmail(body.email, errors).toLowerCase();
  const displayName = nameField(body.displayName, errors, 'displayName');
  const handle = validHandle(body.handle, errors);
  const password = passwordForNewAccount(body.password, errors);
  if (Object.keys(errors).length > 0) throw E.validation(errors);
  const existingEmail = await one(ctx.db, `select 1 from accounts where lower(email) = $1`, [email]);
  if (existingEmail) {
    throw E.validation({ email: 'That email already has an account.' });
  }
  const existingHandle = await one(ctx.db, `select 1 from accounts where handle = $1`, [handle]);
  if (existingHandle) {
    throw E.validation({ handle: 'That handle is taken.' });
  }
  const id = newId();
  await ctx.db.query(
    `insert into accounts (id, email, display_name, handle, password_hash, role) values ($1,$2,$3,$4,$5,'follower')`,
    [id, email, displayName, handle, hashPassword(password)],
  );
  const token = newToken('sess');
  await ctx.db.query(`insert into sessions (token, account_id) values ($1,$2)`, [token, id]);
  setSessionCookie(res, token);
  const row = (await one<AccountRow>(ctx.db, `select * from accounts where id = $1`, [id]))!;
  await accountResponse(app, res, row);
}

async function me(app: App, _req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx): Promise<void> {
  if (!ctx.account) throw E.unauthenticated();
  await accountResponse(app, res, ctx.account);
}

async function inviteInfo(token: string, _app: App, _req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, _url: URL): Promise<void> {
  const row = await one<{
    workspace_name: string;
    email: string;
    display_name: string;
    used_at: Date | null;
  }>(
    ctx.db,
    `select w.name as workspace_name, i.email, i.display_name, i.used_at
       from invites i join workspaces w on w.id = i.workspace_id
      where i.token = $1`,
    [token],
  );
  if (!row) throw E.notFound();
  if (row.used_at) throw E.inviteUsed();
  const existing = await one(ctx.db, `select 1 from accounts where lower(email) = $1`, [row.email.toLowerCase()]);
  if (existing) throw E.inviteUsed();
  sendJson(res, 200, { workspaceName: row.workspace_name, email: row.email, displayName: row.display_name });
}

async function inviteAccept(token: string, app: App, req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, _url: URL): Promise<void> {
  const body = await readJsonBody(req);
  const errors: FieldErrors = {};
  const handle = validHandle(body.handle, errors);
  const password = passwordForNewAccount(body.password, errors);
  if (Object.keys(errors).length > 0) throw E.validation(errors);
  const row = await one<{ workspace_id: string; email: string; display_name: string; used_at: Date | null }>(
    ctx.db,
    `select workspace_id, email, display_name, used_at from invites where token = $1`,
    [token],
  );
  if (!row) throw E.notFound();
  if (row.used_at) throw E.inviteUsed();
  const existing = await one(ctx.db, `select 1 from accounts where lower(email) = $1`, [row.email.toLowerCase()]);
  if (existing) throw E.inviteUsed();
  const existingHandle = await one(ctx.db, `select 1 from accounts where handle = $1`, [handle]);
  if (existingHandle) throw E.validation({ handle: 'That handle is taken.' });
  const ws = (await one<WorkspaceRow>(ctx.db, `select * from workspaces where id = $1`, [row.workspace_id]))!;
  const id = newId();
  await ctx.db.query(
    `insert into accounts (id, email, display_name, handle, password_hash, role, group_id, workspace_id, has_seat)
     values ($1,$2,$3,$4,$5,'designer',$6,$7,false)`,
    [id, row.email.toLowerCase(), row.display_name, handle, hashPassword(password), ws.group_id, ws.id],
  );
  await ctx.db.query(`update invites set used_at = now() where workspace_id = $1 and lower(email) = $2`, [
    ws.id,
    row.email.toLowerCase(),
  ]);
  const token2 = newToken('sess');
  await ctx.db.query(`insert into sessions (token, account_id) values ($1,$2)`, [token2, id]);
  setSessionCookie(res, token2);
  const account = (await one<AccountRow>(ctx.db, `select * from accounts where id = $1`, [id]))!;
  await accountResponse(app, res, account);
}
