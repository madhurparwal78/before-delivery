import type { IncomingMessage, ServerResponse } from 'node:http';
import type { App } from './app.js';
import type { AppConfig } from './config.js';
import type { Db } from './db.js';
import { ApiError, notFound, unauthenticated, invalid, forbiddenRole, saveUnavailable, errorBody } from '../shared/errors.js';
import { parseJsonBody } from './body.js';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { DocumentOp, Role, Document } from '../shared/model.js';
import { LIMITS } from '../shared/model.js';
import { hasControlChars, isEmail, normalizeEmail, OP_ID_PATTERN, ID_PATTERN } from '../shared/ids.js';
import {
  hashPassword, verifyPassword, createSession, sessionUser,
  sessionCookieHeader, clearSessionCookieHeader, SESSION_COOKIE_NAME,
} from './sessions.js';
import { applyOperation, validateOperation, validatePublishedKeys, newDocument, rerouteDocument } from './documents.js';
import { fieldEmailError, fieldPasswordError, fieldNameError, fieldTitleError, fieldControlCharsError, mentionCandidates, mentionEmailSubject, inviteEmailSubject } from '../shared/copy.js';
import { sendMail } from './mail.js';
import { cutVersion } from './boot.js';
import { renderExport } from './exports.js';

export interface Ctx {
  req: IncomingMessage & { lwSessionToken?: string | null };
  res: ServerResponse;
  body: Buffer;
  app: App;
  config: AppConfig;
  db: Db;
  parsedBody?: unknown;
}

interface RouteHandler {
  method: string;
  pattern: RegExp;
  keys: string[];
  handle: (ctx: Ctx, params: Record<string, string>) => Promise<void>;
}

const routes: RouteHandler[] = [];

function route(method: string, path: string, handle: RouteHandler['handle']): void {
  const keys: string[] = [];
  const pattern = new RegExp('^' + path.replace(/:[A-Za-z]+/g, (m) => {
    keys.push(m.slice(1));
    return '([^/]+)';
  }) + '$');
  routes.push({ method, pattern, keys, handle });
}

function json(res: ServerResponse, status: number, value: unknown, headers?: Record<string, string>): void {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

function error(res: ServerResponse, err: ApiError): void {
  json(res, err.status, errorBody(err));
}

function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = req.headers['cookie'];
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

async function currentUser(ctx: Ctx): Promise<{ id: string; email: string; name: string } | null> {
  const token = cookies(ctx.req)[SESSION_COOKIE_NAME] ?? null;
  ctx.req.lwSessionToken = token;
  return sessionUser(ctx.db, token);
}

async function requireUser(ctx: Ctx): Promise<{ id: string; email: string; name: string }> {
  const user = await currentUser(ctx);
  if (!user) throw unauthenticated();
  return user;
}

async function requireMember(ctx: Ctx, diagramId: string): Promise<{ user: { id: string; email: string; name: string }; role: Role; doc: Document }> {
  const user = await requireUser(ctx);
  const member = await ctx.db.query(
    'SELECT role FROM members WHERE diagram_id = $1 AND user_id = $2', [diagramId, user.id]);
  const roleRow = member.rows[0] as { role: Role } | undefined;
  if (!roleRow) throw notFound();
  const doc = await ctx.app.loadDocument(diagramId);
  if (!doc) throw notFound();
  return { user, role: roleRow.role, doc };
}

function requireEdit(role: Role): void {
  if (role === 'viewer') throw forbiddenRole();
}

function requireOwner(role: Role): void {
  if (role !== 'owner') throw forbiddenRole();
}

function text(body: unknown | undefined): Record<string, unknown> {
  return (body ?? {}) as Record<string, unknown>;
}

/** Checks a diagram id or any other id against the not-found rule. */
function assertKnownId(value: string): void {
  if (!ID_PATTERN.test(value)) throw notFound();
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const STATIC_ROOT = '/app/public';
const CLIENT_ROOT = '/app/dist/client';

const PATH_BLOCKLIST = [
  'package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock',
  'tsconfig.json', 'run.json', '.env',
];

function looksLikeSource(name: string): boolean {
  return name.endsWith('.ts') || name.endsWith('.map') || name.startsWith('.env');
}

async function serveFile(res: ServerResponse, filePath: string): Promise<void> {
  if (!existsSync(filePath)) {
    sendNotFound(res);
    return;
  }
  const stat = statSync(filePath);
  if (!stat.isFile()) {
    sendNotFound(res);
    return;
  }
  const data = await readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME_TYPES[ext] ?? 'application/octet-stream';
  res.writeHead(200, {
    'content-type': type,
    'content-length': data.length,
    'cache-control': 'no-cache',
  });
  res.end(data);
}

function sendNotFound(res: ServerResponse): void {
  const body = JSON.stringify({ error: { code: 'not_found', message: 'Diagram not found.' } });
  res.writeHead(404, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

export async function registerRoutes(ctx: Ctx): Promise<void> {
  const url = new URL(ctx.req.url ?? '/', 'http://localhost');
  const pathname = url.pathname;
  const method = (ctx.req.method ?? 'GET').toUpperCase();

  // Same-origin rule for state-changing requests.
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const origin = ctx.req.headers['origin'];
    if (origin) {
      const own = `http://127.0.0.1:${ctx.config.port}`;
      const publicOwn = new URL(ctx.config.appPublicUrl).origin;
      if (origin !== own && origin !== publicOwn) {
        json(ctx.res, 403, { error: { code: 'cross_origin', message: 'Cross-origin request refused.' } });
        return;
      }
    }
  }

  ctx.parsedBody = method === 'GET' || method === 'HEAD' ? undefined : parseJsonBody(ctx.body);

  for (const r of routes) {
    if (r.method !== method) continue;
    const match = r.pattern.exec(pathname);
    if (!match) continue;
    const params: Record<string, string> = {};
    r.keys.forEach((key, i) => { params[key] = decodeURIComponent(match[i + 1]!); });
    await r.handle(ctx, params);
    return;
  }

  // Static client files and the app shell.
  if (method === 'GET' || method === 'HEAD') {
    if (pathname.startsWith('/api/')) {
      sendNotFound(ctx.res);
      return;
    }
    const base = path.basename(pathname);
    if (base === '' || pathname === '/' || pathname === '/signin' || pathname === '/signup'
      || pathname.startsWith('/d/') || pathname === '/favicon.ico') {
      await serveFile(ctx.res, `${STATIC_ROOT}/index.html`);
      return;
    }
    if (PATH_BLOCKLIST.includes(base) || looksLikeSource(base)) {
      sendNotFound(ctx.res);
      return;
    }
    const clean = path.normalize(pathname).replace(/^([.][.][/\\])+/, '');
    const clientPath = path.join(CLIENT_ROOT, clean);
    const publicPath = path.join(STATIC_ROOT, clean);
    if (clientPath.startsWith(CLIENT_ROOT) && existsSync(clientPath)) {
      await serveFile(ctx.res, clientPath);
      return;
    }
    if (publicPath.startsWith(STATIC_ROOT) && existsSync(publicPath)) {
      await serveFile(ctx.res, publicPath);
      return;
    }
    sendNotFound(ctx.res);
    return;
  }

  json(ctx.res, 404, { error: { code: 'not_found', message: 'Diagram not found.' } });
}

// ---- Health ----
route('GET', '/api/health', async (ctx) => {
  json(ctx.res, 200, { status: 'ok' });
});

// ---- Auth ----
route('POST', '/api/auth/signup', async (ctx) => {
  const b = text(ctx.parsedBody);
  const errors: Record<string, string> = {};
  const name = typeof b['name'] === 'string' ? b['name'] : '';
  const email = typeof b['email'] === 'string' ? normalizeEmail(b['email']) : '';
  const password = typeof b['password'] === 'string' ? b['password'] : '';
  if (name.length < 1 || name.length > LIMITS.displayNameLength) errors['name'] = fieldNameError;
  else if (hasControlChars(name)) errors['name'] = fieldControlCharsError;
  if (!isEmail(email)) errors['email'] = fieldEmailError;
  if (password.length < 10) errors['password'] = fieldPasswordError;
  if (Object.keys(errors).length > 0) throw invalid(errors);
  const taken = await ctx.db.query('SELECT id FROM users WHERE email = $1', [email]);
  if (taken.rows.length > 0) throw new ApiError(409, 'email_taken', fieldTitleError);
  const id = ctx.app.newId('u');
  await ctx.db.query(
    'INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)',
    [id, email, name, hashPassword(password)]);
  const token = await createSession(ctx.db, id);
  await acceptInvites(ctx, email, id);
  json(ctx.res, 201, { user: { id, email, name } },
    { 'set-cookie': sessionCookieHeader(token) });
});

route('POST', '/api/auth/signin', async (ctx) => {
  const b = text(ctx.parsedBody);
  const email = typeof b['email'] === 'string' ? normalizeEmail(b['email']) : '';
  const password = typeof b['password'] === 'string' ? b['password'] : '';
  const result = await ctx.db.query('SELECT id, email, name, password_hash FROM users WHERE email = $1', [email]);
  const row = result.rows[0] as { id: string; email: string; name: string; password_hash: string } | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw new ApiError(401, 'bad_credentials', 'Email or password is incorrect.');
  }
  const token = await createSession(ctx.db, row.id);
  await acceptInvites(ctx, email, row.id);
  json(ctx.res, 200, { user: { id: row.id, email: row.email, name: row.name } },
    { 'set-cookie': sessionCookieHeader(token) });
});

route('POST', '/api/auth/signout', async (ctx) => {
  const token = cookies(ctx.req)[SESSION_COOKIE_NAME] ?? null;
  if (token) {
    await ctx.db.query('DELETE FROM sessions WHERE token = $1', [token]);
    // Every socket opened with this session closes with 4401 within a second.
    const { closeSocketsForSession } = await import('./sockets.js');
    closeSocketsForSession(token, 4401, 'session_ended');
  }
  json(ctx.res, 204, {}, { 'set-cookie': clearSessionCookieHeader() });
  ctx.res.end();
});

route('GET', '/api/me', async (ctx) => {
  const user = await requireUser(ctx);
  json(ctx.res, 200, { user });
});

// ---- Diagrams ----
route('GET', '/api/diagrams', async (ctx) => {
  const user = await requireUser(ctx);
  const result = await ctx.db.query(
    `SELECT d.id, d.title, m.role, d.updated_at FROM diagrams d
     JOIN members m ON m.diagram_id = d.id WHERE m.user_id = $1
     ORDER BY d.updated_at DESC`, [user.id]);
  json(ctx.res, 200, { diagrams: result.rows });
});

route('POST', '/api/diagrams', async (ctx) => {
  const user = await requireUser(ctx);
  const b = text(ctx.parsedBody);
  const title = typeof b['title'] === 'string' ? b['title'] : '';
  const errors: Record<string, string> = {};
  if (title.length < 1 || title.length > LIMITS.titleLength) errors['title'] = fieldTitleError;
  else if (hasControlChars(title)) errors['title'] = fieldControlCharsError;
  if (Object.keys(errors).length > 0) throw invalid(errors);
  const id = ctx.app.newId('d');
  const doc = newDocument(id, title);
  await ctx.db.query('INSERT INTO diagrams (id, title) VALUES ($1, $2)', [id, title]);
  await ctx.db.query('INSERT INTO documents (diagram_id, content) VALUES ($1, $2)', [id, JSON.stringify(doc)]);
  await ctx.db.query('INSERT INTO members (diagram_id, user_id, role) VALUES ($1, $2, $3)', [id, user.id, 'owner']);
  json(ctx.res, 201, { diagram: { id, title }, document: doc });
});

route('GET', '/api/diagrams/:diagramId/document', async (ctx, p) => {
  assertKnownId(p['diagramId']!);
  const { doc } = await requireMember(ctx, p['diagramId']!);
  json(ctx.res, 200, doc);
});

route('POST', '/api/diagrams/:diagramId/operations', async (ctx, p) => {
  assertKnownId(p['diagramId']!);
  const diagramId = p['diagramId']!;
  const { user, role } = await requireMember(ctx, diagramId);
  const b = text(ctx.parsedBody);
  const opId = typeof b['opId'] === 'string' ? b['opId'] : '';
  const baseSeq = b['baseSeq'];
  const op = b['op'];
  const extra: Record<string, string> = {};
  for (const key of Object.keys(b)) {
    if (key !== 'opId' && key !== 'baseSeq' && key !== 'op') extra[`@${key}`] = 'Unexpected key.';
  }
  if (Object.keys(extra).length > 0) {
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(extra)) cleaned[k.slice(1)] = v;
    throw invalid(cleaned);
  }
  if (!OP_ID_PATTERN.test(opId)) throw invalid({ opId: 'Invalid op id.' });
  if (typeof baseSeq !== 'number' || !Number.isInteger(baseSeq) || baseSeq < 0) {
    throw invalid({ baseSeq: 'Invalid base seq.' });
  }
  const keyErrors = validatePublishedKeys(op);
  if (keyErrors) throw invalid(keyErrors);
  const docOp = op as DocumentOp;
  const valueErrors = validateOperation(docOp);
  if (valueErrors) throw invalid(valueErrors);

  const outage = ctx.app.outageUntil(diagramId);
  if (outage > Date.now()) throw saveUnavailable();
  requireEdit(role);

  const ack = await ctx.app.acceptOperation(diagramId, user.id, role, opId, docOp);
  json(ctx.res, 200, ack);
});

// ---- Members and invites ----
route('GET', '/api/diagrams/:diagramId/members', async (ctx, p) => {
  assertKnownId(p['diagramId']!);
  await requireMember(ctx, p['diagramId']!);
  const diagramId = p['diagramId']!;
  const members = await ctx.db.query(
    `SELECT m.user_id, u.email, u.name, m.role FROM members m JOIN users u ON u.id = m.user_id
     WHERE m.diagram_id = $1 ORDER BY u.name`, [diagramId]);
  const inviteRows = await ctx.db.query(
    `SELECT id, email, role, status, resent_at FROM invites WHERE diagram_id = $1`, [diagramId]);
  const now = Date.now();
  const invites = [];
  for (const row of inviteRows.rows as { id: string; email: string; role: Role; status: string; resent_at: Date }[]) {
    if (row.status === 'emailed' || row.status === 'email_not_sent') {
      const expired = now - row.resent_at.getTime() >= ctx.config.inviteTtlMs;
      if (expired) {
        await ctx.db.query(`UPDATE invites SET status = 'expired' WHERE id = $1`, [row.id]);
        row.status = 'expired';
      }
    }
    if (row.status === 'revoked' || row.status === 'accepted') continue;
    invites.push({
      id: row.id, email: row.email, role: row.role, status: row.status,
      expiresAt: new Date(row.resent_at.getTime() + ctx.config.inviteTtlMs).toISOString(),
    });
  }
  json(ctx.res, 200, {
    members: members.rows.map((m: { user_id: string; email: string; name: string; role: Role }) => ({
      userId: m.user_id, email: m.email, name: m.name, role: m.role, status: 'active',
    })),
    invites,
  });
});

route('POST', '/api/diagrams/:diagramId/invites', async (ctx, p) => {
  assertKnownId(p['diagramId']!);
  const diagramId = p['diagramId']!;
  const { user, role, doc } = await requireMember(ctx, diagramId);
  requireOwner(role);
  const b = text(ctx.parsedBody);
  const email = typeof b['email'] === 'string' ? normalizeEmail(b['email']) : '';
  const inviteRole = b['role'];
  if (!isEmail(email)) throw invalid({ email: fieldEmailError });
  if (inviteRole !== 'editor' && inviteRole !== 'viewer') throw invalid({ role: 'Invalid role.' });
  const existingMember = await ctx.db.query(
    `SELECT 1 FROM members m JOIN users u ON u.id = m.user_id WHERE m.diagram_id = $1 AND u.email = $2`,
    [diagramId, email]);
  if (existingMember.rows.length > 0) throw new ApiError(409, 'already_member', 'Already a member.');
  const open = await ctx.db.query(
    `SELECT id FROM invites WHERE diagram_id = $1 AND email = $2 AND status IN ('emailed','email_not_sent')`,
    [diagramId, email]);
  if (open.rows.length > 0) throw new ApiError(409, 'already_invited', 'Already invited.');
  await ctx.db.query(`DELETE FROM invites WHERE diagram_id = $1 AND email = $2 AND status = 'expired'`, [diagramId, email]);
  const id = ctx.app.newId('i');
  await ctx.db.query(
    `INSERT INTO invites (id, diagram_id, email, role, status) VALUES ($1, $2, $3, $4, 'emailed')`,
    [id, diagramId, email, inviteRole]);
  const inviterName = user.name;
  const subject = inviteEmailSubject(inviterName, doc.title, inviteRole);
  const link = `${ctx.config.appPublicUrl}/d/${diagramId}`;
  const sent = await sendMail(ctx.config, {
    to: email,
    subject,
    text: `${inviterName} shared the diagram "${doc.title}" with you as ${inviteRole === 'editor' ? 'an editor' : 'a viewer'}.\n\nOpen it at ${link}`,
  });
  const status = sent ? 'emailed' : 'email_not_sent';
  await ctx.db.query('UPDATE invites SET status = $2 WHERE id = $1', [id, status]);
  ctx.app.broadcast(diagramId, { kind: 'members', payload: {} });
  json(ctx.res, 201, {
    invite: { id, email, role: inviteRole, status,
      expiresAt: new Date(Date.now() + ctx.config.inviteTtlMs).toISOString() },
  });
});

route('POST', '/api/diagrams/:diagramId/invites/:inviteId/resend', async (ctx, p) => {
  assertKnownId(p['diagramId']!);
  const diagramId = p['diagramId']!;
  const { user, role, doc } = await requireMember(ctx, diagramId);
  requireOwner(role);
  const result = await ctx.db.query(
    `SELECT i.id, i.email, i.role, i.status, u.name AS inviter FROM invites i
     LEFT JOIN users u ON u.id = $2 WHERE i.id = $1 AND i.diagram_id = $3`,
    [p['inviteId']!, user.id, diagramId]);
  const row = result.rows[0] as { id: string; email: string; role: Role; status: string; inviter: string | null } | undefined;
  if (!row) throw notFound();
  if (row.status === 'accepted' || row.status === 'revoked') {
    throw new ApiError(409, 'invite_closed', 'This invite is closed.');
  }
  await ctx.db.query(`UPDATE invites SET status = 'emailed', resent_at = now() WHERE id = $1`, [row.id]);
  const subject = inviteEmailSubject(user.name, doc.title, row.role as 'editor' | 'viewer');
  const link = `${ctx.config.appPublicUrl}/d/${diagramId}`;
  const sent = await sendMail(ctx.config, {
    to: row.email,
    subject,
    text: `${user.name} shared the diagram "${doc.title}" with you as ${row.role === 'editor' ? 'an editor' : 'a viewer'}.\n\nOpen it at ${link}`,
  });
  const status = sent ? 'emailed' : 'email_not_sent';
  await ctx.db.query('UPDATE invites SET status = $2 WHERE id = $1', [row.id, status]);
  ctx.app.broadcast(diagramId, { kind: 'members', payload: {} });
  json(ctx.res, 200, {
    invite: { id: row.id, email: row.email, role: row.role, status,
      expiresAt: new Date(Date.now() + ctx.config.inviteTtlMs).toISOString() },
  });
});

route('DELETE', '/api/diagrams/:diagramId/invites/:inviteId', async (ctx, p) => {
  assertKnownId(p['diagramId']!);
  const diagramId = p['diagramId']!;
  const { role } = await requireMember(ctx, diagramId);
  requireOwner(role);
  const result = await ctx.db.query(
    `SELECT id, status FROM invites WHERE id = $1 AND diagram_id = $2`,
    [p['inviteId']!, diagramId]);
  const row = result.rows[0] as { id: string; status: string } | undefined;
  if (!row) throw notFound();
  if (row.status === 'accepted' || row.status === 'revoked') {
    throw new ApiError(409, 'invite_closed', 'This invite is closed.');
  }
  await ctx.db.query(`UPDATE invites SET status = 'revoked' WHERE id = $1`, [row.id]);
  ctx.app.broadcast(diagramId, { kind: 'members', payload: {} });
  json(ctx.res, 204, {});
  ctx.res.end();
});

route('PATCH', '/api/diagrams/:diagramId/members/:userId', async (ctx, p) => {
  assertKnownId(p['diagramId']!);
  const diagramId = p['diagramId']!;
  const { role } = await requireMember(ctx, diagramId);
  requireOwner(role);
  const target = p['userId']!;
  const b = text(ctx.parsedBody);
  const newRole = b['role'];
  if (newRole !== 'editor' && newRole !== 'viewer' && newRole !== 'owner') {
    throw invalid({ role: 'Invalid role.' });
  }
  const member = await ctx.db.query(
    'SELECT role FROM members WHERE diagram_id = $1 AND user_id = $2', [diagramId, target]);
  const row = member.rows[0] as { role: Role } | undefined;
  if (!row) throw notFound();
  if (row.role === 'owner') throw new ApiError(409, 'owner_role', 'The owner role cannot change.');
  await ctx.db.query('UPDATE members SET role = $3 WHERE diagram_id = $1 AND user_id = $2', [diagramId, target, newRole]);
  ctx.app.broadcast(diagramId, { kind: 'role', payload: { userId: target, role: newRole } });
  const updated = await ctx.db.query(
    `SELECT m.user_id, u.email, u.name, m.role FROM members m JOIN users u ON u.id = m.user_id
     WHERE m.diagram_id = $1 AND m.user_id = $2`, [diagramId, target]);
  json(ctx.res, 200, { member: { ...updated.rows[0], status: 'active' } });
});

route('DELETE', '/api/diagrams/:diagramId/members/:userId', async (ctx, p) => {
  assertKnownId(p['diagramId']!);
  const diagramId = p['diagramId']!;
  const { role } = await requireMember(ctx, diagramId);
  requireOwner(role);
  const target = p['userId']!;
  const member = await ctx.db.query(
    'SELECT role FROM members WHERE diagram_id = $1 AND user_id = $2', [diagramId, target]);
  const row = member.rows[0] as { role: Role } | undefined;
  if (!row) throw notFound();
  if (row.role === 'owner') throw new ApiError(409, 'owner_role', 'The owner cannot be removed.');
  await ctx.db.query('DELETE FROM members WHERE diagram_id = $1 AND user_id = $2', [diagramId, target]);
  ctx.app.broadcast(diagramId, { kind: 'role', payload: { userId: target, removed: true } });
  json(ctx.res, 204, {});
  ctx.res.end();
});

// ---- Comments ----
route('GET', '/api/diagrams/:diagramId/comments', async (ctx, p) => {
  assertKnownId(p['diagramId']!);
  const diagramId = p['diagramId']!;
  await requireMember(ctx, diagramId);
  const result = await ctx.db.query(
    `SELECT c.id, c.page_id, c.shape_id, c.author_id, u.name AS author_name, c.parent, c.text,
            c.resolved, c.anchored, c.created_at
     FROM comments c JOIN users u ON u.id = c.author_id
     WHERE c.diagram_id = $1 ORDER BY c.created_at`, [diagramId]);
  json(ctx.res, 200, { comments: result.rows.map((r: Record<string, unknown>) => ({
    id: r['id'], shape: r['shape_id'], page: r['page_id'],
    author: { id: r['author_id'], name: r['author_name'] },
    text: r['text'], resolved: r['resolved'], anchored: r['anchored'],
    parent: r['parent'], createdAt: r['created_at'],
  })) });
});

route('POST', '/api/diagrams/:diagramId/comments', async (ctx, p) => {
  assertKnownId(p['diagramId']!);
  const diagramId = p['diagramId']!;
  const { user, role, doc } = await requireMember(ctx, diagramId);
  const b = text(ctx.parsedBody);
  const shape = typeof b['shape'] === 'string' ? b['shape'] : '';
  const commentText = typeof b['text'] === 'string' ? b['text'] : '';
  const parent = typeof b['parent'] === 'string' ? b['parent'] : null;
  if (commentText.length < 1 || commentText.length > LIMITS.commentLength) {
    throw invalid({ text: 'Invalid comment text.' });
  }
  let pageId = '';
  for (const page of doc.pages) {
    if (page.shapes.some((s) => s.id === shape)) { pageId = page.id; break; }
  }
  if (!pageId) throw new ApiError(409, 'shape_deleted', 'The shape was deleted.');
  const id = ctx.app.newId('m');
  await ctx.db.query(
    `INSERT INTO comments (id, diagram_id, page_id, shape_id, author_id, parent, text)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, diagramId, pageId, shape, user.id, parent, commentText]);
  ctx.app.broadcast(diagramId, { kind: 'comment', payload: { id } });
  // Mentions: one email per mentioned member other than the author.
  const mentions = new Set(mentionCandidates(commentText).map((m) => normalizeEmail(m)));
  if (mentions.size > 0) {
    const members = await ctx.db.query(
      `SELECT u.id, u.email, u.name FROM members m JOIN users u ON u.id = m.user_id WHERE m.diagram_id = $1`,
      [diagramId]);
    const mentioned = (members.rows as { id: string; email: string; name: string }[])
      .filter((m) => mentions.has(normalizeEmail(m.email)) && m.id !== user.id);
    const seenEmails = new Set<string>();
    const link = `${ctx.config.appPublicUrl}/d/${diagramId}`;
    for (const m of mentioned) {
      if (seenEmails.has(m.email)) continue;
      seenEmails.add(m.email);
      const shapeLabelValue = findShapeLabel(doc, shape);
      await sendMail(ctx.config, {
        to: m.email,
        subject: mentionEmailSubject(user.name, doc.title),
        text: `${user.name} mentioned you on "${doc.title}" in a comment on ${shapeLabelValue}:\n\n${commentText}\n\nOpen it at ${link}`,
      });
    }
  }
  const created = await ctx.db.query(
    `SELECT c.id, c.page_id, c.shape_id, c.author_id, u.name AS author_name, c.parent, c.text, c.resolved, c.anchored, c.created_at
     FROM comments c JOIN users u ON u.id = c.author_id WHERE c.id = $1`, [id]);
  const r = created.rows[0] as Record<string, unknown>;
  json(ctx.res, 201, { comment: {
    id: r['id'], shape: r['shape_id'], page: r['page_id'],
    author: { id: r['author_id'], name: r['author_name'] },
    text: r['text'], resolved: r['resolved'], anchored: r['anchored'],
    parent: r['parent'], createdAt: r['created_at'],
  } });
  void role;
});

route('POST', '/api/diagrams/:diagramId/comments/:commentId/resolve', async (ctx, p) => {
  assertKnownId(p['diagramId']!);
  const diagramId = p['diagramId']!;
  const { user, role } = await requireMember(ctx, diagramId);
  const result = await ctx.db.query(
    `SELECT id, author_id, resolved FROM comments WHERE id = $1 AND diagram_id = $2`,
    [p['commentId']!, diagramId]);
  const row = result.rows[0] as { id: string; author_id: string; resolved: boolean } | undefined;
  if (!row) throw notFound();
  if (role === 'viewer' && row.author_id !== user.id) throw forbiddenRole();
  if (row.resolved) throw new ApiError(409, 'already_resolved', 'Already resolved.');
  await ctx.db.query('UPDATE comments SET resolved = true WHERE id = $1', [row.id]);
  ctx.app.broadcast(diagramId, { kind: 'comment', payload: { id: row.id } });
  const updated = await ctx.db.query(
    `SELECT c.id, c.page_id, c.shape_id, c.author_id, u.name AS author_name, c.parent, c.text, c.resolved, c.anchored, c.created_at
     FROM comments c JOIN users u ON u.id = c.author_id WHERE c.id = $1`, [row.id]);
  const r = updated.rows[0] as Record<string, unknown>;
  json(ctx.res, 200, { comment: {
    id: r['id'], shape: r['shape_id'], page: r['page_id'],
    author: { id: r['author_id'], name: r['author_name'] },
    text: r['text'], resolved: r['resolved'], anchored: r['anchored'],
    parent: r['parent'], createdAt: r['created_at'],
  } });
});

// ---- Versions ----
route('GET', '/api/diagrams/:diagramId/versions', async (ctx, p) => {
  assertKnownId(p['diagramId']!);
  const diagramId = p['diagramId']!;
  await requireMember(ctx, diagramId);
  const result = await ctx.db.query(
    `SELECT v.id, v.number, v.name, v.author_id, u.name AS author_name, v.created_at, v.seq
     FROM versions v JOIN users u ON u.id = v.author_id
     WHERE v.diagram_id = $1 ORDER BY v.created_at DESC, v.number DESC`, [diagramId]);
  json(ctx.res, 200, { versions: result.rows.map((r: Record<string, unknown>) => ({
    id: r['id'], number: r['number'], name: r['name'],
    displayName: (r['name'] as string | null) ?? `Version ${r['number']}`,
    author: { id: r['author_id'], name: r['author_name'] },
    createdAt: r['created_at'], seq: r['seq'],
  })) });
});

route('POST', '/api/diagrams/:diagramId/versions', async (ctx, p) => {
  assertKnownId(p['diagramId']!);
  const diagramId = p['diagramId']!;
  const { user, role, doc } = await requireMember(ctx, diagramId);
  requireEdit(role);
  const b = text(ctx.parsedBody);
  const name = typeof b['name'] === 'string' ? b['name'] : null;
  if (name !== null && (name.length < 0 || name.length > LIMITS.versionNameLength)) {
    throw invalid({ name: 'Invalid version name.' });
  }
  await cutVersion(ctx.app, diagramId, user.id, name, doc.seq);
  const result = await ctx.db.query(
    `SELECT v.id, v.number, v.name, v.author_id, u.name AS author_name, v.created_at, v.seq
     FROM versions v JOIN users u ON u.id = v.author_id
     WHERE v.diagram_id = $1 ORDER BY v.created_at DESC, v.number DESC LIMIT 1`, [diagramId]);
  const r = result.rows[0] as Record<string, unknown>;
  json(ctx.res, 201, { version: {
    id: r['id'], number: r['number'], name: r['name'],
    displayName: (r['name'] as string | null) ?? `Version ${r['number']}`,
    author: { id: r['author_id'], name: r['author_name'] },
    createdAt: r['created_at'], seq: r['seq'],
  } });
});

route('GET', '/api/diagrams/:diagramId/versions/:versionId', async (ctx, p) => {
  assertKnownId(p['diagramId']!);
  const diagramId = p['diagramId']!;
  await requireMember(ctx, diagramId);
  const result = await ctx.db.query(
    `SELECT v.id, v.number, v.name, v.author_id, u.name AS author_name, v.created_at, v.seq, v.content
     FROM versions v JOIN users u ON u.id = v.author_id
     WHERE v.id = $1 AND v.diagram_id = $2`, [p['versionId']!, diagramId]);
  const r = result.rows[0] as Record<string, unknown> | undefined;
  if (!r) throw notFound();
  json(ctx.res, 200, {
    version: {
      id: r['id'], number: r['number'], name: r['name'],
      displayName: (r['name'] as string | null) ?? `Version ${r['number']}`,
      author: { id: r['author_id'], name: r['author_name'] },
      createdAt: r['created_at'], seq: r['seq'],
    },
    document: r['content'],
  });
});

route('POST', '/api/diagrams/:diagramId/versions/:versionId/restore', async (ctx, p) => {
  assertKnownId(p['diagramId']!);
  const diagramId = p['diagramId']!;
  const { user, role } = await requireMember(ctx, diagramId);
  requireOwner(role);
  const result = await ctx.db.query(
    `SELECT id, number, name, content, author_id FROM versions WHERE id = $1 AND diagram_id = $2`,
    [p['versionId']!, diagramId]);
  const r = result.rows[0] as { id: string; number: number; name: string | null; content: Document; author_id: string } | undefined;
  if (!r) throw notFound();
  const restored: Document = JSON.parse(JSON.stringify(r.content)) as Document;
  restored.id = diagramId;
  const current = await ctx.app.loadDocument(diagramId);
  if (!current) throw notFound();
  restored.seq = current.seq;
  rerouteDocument(restored);
  // Anchoring rule: a comment is anchored when its shape exists in the restored doc.
  const shapeIds = new Set<string>();
  for (const page of restored.pages) for (const s of page.shapes) shapeIds.add(s.id);
  const comments = await ctx.db.query('SELECT id, shape_id FROM comments WHERE diagram_id = $1', [diagramId]);
  for (const c of comments.rows as { id: string; shape_id: string }[]) {
    await ctx.db.query('UPDATE comments SET anchored = $2 WHERE id = $1', [c.id, shapeIds.has(c.shape_id)]);
  }
  await ctx.app.saveDocument(restored);
  const displayName = r.name ?? `Version ${r.number}`;
  await cutVersion(ctx.app, diagramId, user.id, `Restored ${displayName}`, restored.seq);
  ctx.app.broadcast(diagramId, { kind: 'restore', payload: { by: user.name, versionName: displayName } });
  const newVersion = await ctx.db.query(
    `SELECT v.id, v.number, v.name, v.author_id, u.name AS author_name, v.created_at, v.seq
     FROM versions v JOIN users u ON u.id = v.author_id
     WHERE v.diagram_id = $1 ORDER BY v.created_at DESC LIMIT 1`, [diagramId]);
  json(ctx.res, 200, { version: newVersion.rows[0], seq: restored.seq });
});

// ---- Exports ----
route('GET', '/api/diagrams/:diagramId/exports', async (ctx, p) => {
  assertKnownId(p['diagramId']!);
  const diagramId = p['diagramId']!;
  await requireMember(ctx, diagramId);
  const result = await ctx.db.query(
    `SELECT id, status, format, page_id, seq, requested_by, width, height, created_at
     FROM exports WHERE diagram_id = $1 ORDER BY created_at DESC`, [diagramId]);
  json(ctx.res, 200, { exports: result.rows.map((r: Record<string, unknown>) => ({
    id: r['id'], status: r['status'], format: r['format'], page: r['page_id'],
    seq: r['seq'], requestedBy: r['requested_by'],
    width: r['width'], height: r['height'], createdAt: r['created_at'],
  })) });
});

route('POST', '/api/diagrams/:diagramId/exports', async (ctx, p) => {
  assertKnownId(p['diagramId']!);
  const diagramId = p['diagramId']!;
  const { user, role, doc } = await requireMember(ctx, diagramId);
  requireEdit(role);
  const b = text(ctx.parsedBody);
  const page = typeof b['page'] === 'string' ? b['page'] : '';
  const format = b['format'] === 'svg' ? 'svg' : b['format'] === 'png' ? 'png' : null;
  const scale = b['scale'] === 2 ? 2 : 1;
  const background = b['background'] === 'transparent' ? 'transparent' : 'white';
  if (!format) throw invalid({ format: 'Invalid format.' });
  if (b['scale'] !== 1 && b['scale'] !== 2) throw invalid({ scale: 'Invalid scale.' });
  if (b['background'] !== 'white' && b['background'] !== 'transparent') {
    throw invalid({ background: 'Invalid background.' });
  }
  if (format === 'svg' && scale !== 1) throw invalid({ scale: 'Invalid scale.' });
  const pageObj = doc.pages.find((pg) => pg.id === page);
  if (!pageObj) throw notFound();
  const visibleIds = new Set(pageObj.layers.filter((l) => l.visible).map((l) => l.id));
  if (!pageObj.shapes.some((s) => visibleIds.has(s.layer))) {
    throw invalid({ page: 'This page has no visible shape.' });
  }
  // One export per request: a rendering export with the same settings at this seq.
  const existing = await ctx.db.query(
    `SELECT id, status, format, page_id, seq, requested_by, width, height, created_at
     FROM exports WHERE diagram_id = $1 AND requested_by = $2 AND status = 'rendering'
       AND page_id = $3 AND format = $4 AND scale = $5 AND background = $6 AND seq = $7`,
    [diagramId, user.id, page, format, scale, background, doc.seq]);
  if ((existing.rows.length ?? 0) > 0) {
    const r = existing.rows[0] as Record<string, unknown>;
    json(ctx.res, 200, {
      id: r['id'], status: r['status'], format: r['format'], page: r['page_id'],
      seq: r['seq'], width: r['width'], height: r['height'],
    });
    return;
  }
  const id = ctx.app.newId('x');
  await ctx.db.query(
    `INSERT INTO exports (id, diagram_id, page_id, format, scale, background, seq, requested_by, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'rendering')`,
    [id, diagramId, page, format, scale, background, doc.seq, user.id]);
  void renderExport(ctx.app, ctx.config, id);
  json(ctx.res, 202, { id, status: 'rendering', format, page, seq: doc.seq, width: null, height: null });
});

route('GET', '/api/exports/:exportId', async (ctx, p) => {
  const result = await ctx.db.query(
    `SELECT e.id, e.status, e.format, e.page_id, e.seq, e.requested_by, e.width, e.height, e.diagram_id
     FROM exports e WHERE e.id = $1`, [p['exportId']!]);
  const r = result.rows[0] as Record<string, unknown> | undefined;
  if (!r) throw notFound();
  const diagramId = r['diagram_id'] as string;
  const member = await currentUser(ctx);
  if (!member) throw unauthenticated();
  const isMember = await ctx.db.query(
    'SELECT 1 FROM members WHERE diagram_id = $1 AND user_id = $2', [diagramId, member.id]);
  if ((isMember.rows.length ?? 0) === 0) throw notFound();
  json(ctx.res, 200, {
    id: r['id'], status: r['status'], format: r['format'], page: r['page_id'],
    seq: r['seq'], width: r['width'], height: r['height'],
  });
});

route('GET', '/api/exports/:exportId/file', async (ctx, p) => {
  const result = await ctx.db.query(
    `SELECT id, status, format, page_id, diagram_id FROM exports WHERE id = $1`, [p['exportId']!]);
  const r = result.rows[0] as { id: string; status: string; format: 'png' | 'svg'; page_id: string; diagram_id: string } | undefined;
  if (!r) throw notFound();
  const member = await currentUser(ctx);
  if (!member) throw unauthenticated();
  const isMember = await ctx.db.query(
    'SELECT 1 FROM members WHERE diagram_id = $1 AND user_id = $2', [r.diagram_id, member.id]);
  if ((isMember.rows.length ?? 0) === 0) throw notFound();
  if (r.status !== 'ready') throw new ApiError(409, 'export_not_ready', 'Export is not ready.');
  const { getObject, exportKey } = await import('./storage.js');
  const buffer = await getObject(ctx.config, exportKey(r.diagram_id, r.id, r.format));
  if (!buffer) throw notFound();
  const contentType = r.format === 'svg' ? 'image/svg+xml' : 'image/png';
  ctx.res.writeHead(200, { 'content-type': contentType, 'content-length': buffer.length });
  ctx.res.end(buffer);
});

route('POST', '/api/exports/:exportId/retry', async (ctx, p) => {
  const result = await ctx.db.query(
    `SELECT id, status, format, page_id, seq, requested_by, width, height, diagram_id
     FROM exports WHERE id = $1`, [p['exportId']!]);
  const r = result.rows[0] as Record<string, unknown> | undefined;
  if (!r) throw notFound();
  const user = await currentUser(ctx);
  if (!user) throw unauthenticated();
  requireEdit((await ctx.db.query(
    'SELECT role FROM members WHERE diagram_id = $1 AND user_id = $2',
    [r['diagram_id'], user.id])).rows[0] as unknown as Role);
  const status = r['status'] as string;
  const { renderExport } = await import('./exports.js');
  const moved = await ctx.db.query(
    `UPDATE exports SET status = 'rendering' WHERE id = $1 AND status = 'storage_unavailable' RETURNING id`,
    [p['exportId']!]);
  if ((moved.rows.length ?? 0) === 0) {
    throw new ApiError(409, 'export_not_retryable', 'This export cannot be retried.');
  }
  void renderExport(ctx.app, ctx.config, p['exportId']!);
  const fresh = await ctx.db.query(
    `SELECT id, status, format, page_id, seq, width, height FROM exports WHERE id = $1`, [p['exportId']!]);
  const fr = fresh.rows[0] as Record<string, unknown>;
  json(ctx.res, 202, {
    id: fr['id'], status: fr['status'], format: fr['format'], page: fr['page_id'],
    seq: fr['seq'], width: fr['width'], height: fr['height'],
  });
});

// ---- Grading routes ----
route('POST', '/api/grading/seed', async (ctx) => {
  if (!ctx.config.gradingRoutes) { notFoundResponder(ctx); return; }
  await seedGrading(ctx);
});

route('POST', '/api/grading/save-outage', async (ctx) => {
  if (!ctx.config.gradingRoutes) { notFoundResponder(ctx); return; }
  const b = text(ctx.parsedBody);
  const diagramId = typeof b['diagramId'] === 'string' ? b['diagramId'] : '';
  const ms = b['ms'];
  if (typeof ms !== 'number' || !Number.isInteger(ms) || ms < 1 || ms > 60000) {
    throw invalid({ ms: 'Invalid duration.' });
  }
  if (!ID_PATTERN.test(diagramId)) throw invalid({ diagramId: 'Invalid diagram id.' });
  const exists = await ctx.db.query('SELECT id FROM diagrams WHERE id = $1', [diagramId]);
  if ((exists.rows.length ?? 0) === 0) throw notFound();
  const until = Date.now() + ms;
  ctx.app.setOutage(diagramId, until);
  const { closeSocketsForDiagram } = await import('./sockets.js');
  closeSocketsForDiagram(diagramId, 4503, 'save_unavailable');
  json(ctx.res, 200, { until: new Date(until).toISOString() });
});

function notFoundResponder(ctx: Ctx): void {
  json(ctx.res, 404, { error: { code: 'not_found', message: 'Diagram not found.' } });
}

async function acceptInvites(ctx: Ctx, email: string, userId: string): Promise<void> {
  const invites = await ctx.db.query(
    `SELECT id, diagram_id, role, status, resent_at FROM invites WHERE email = $1`, [email]);
  const now = Date.now();
  for (const row of invites.rows as { id: string; diagram_id: string; role: Role; status: string; resent_at: Date }[]) {
    if (row.status !== 'emailed' && row.status !== 'email_not_sent') continue;
    if (now - row.resent_at.getTime() >= ctx.config.inviteTtlMs) {
      await ctx.db.query(`UPDATE invites SET status = 'expired' WHERE id = $1`, [row.id]);
      continue;
    }
    await ctx.db.query(`UPDATE invites SET status = 'accepted' WHERE id = $1`, [row.id]);
    await ctx.db.query(
      `INSERT INTO members (diagram_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`, [row.diagram_id, userId, row.role]);
    ctx.app.broadcast(row.diagram_id, { kind: 'members', payload: {} });
  }
}

function findShapeLabel(doc: Document, shapeId: string): string {
  for (const page of doc.pages) {
    const shape = page.shapes.find((s) => s.id === shapeId);
    if (shape) return shape.label.length === 0 ? `Untitled ${shape.kind}` : shape.label;
  }
  return 'a shape';
}

async function seedGrading(ctx: Ctx): Promise<void> {
  const b = text(ctx.parsedBody);
  const users = b['users'];
  const diagrams = b['diagrams'];
  if (!Array.isArray(users) || !Array.isArray(diagrams)) throw invalid({ users: 'Invalid users.' });
  const errors: Record<string, string> = {};
  const userRows: { email: string; name: string; password: string }[] = [];
  users.forEach((u: unknown, i) => {
    const rec = (u ?? {}) as Record<string, unknown>;
    const email = typeof rec['email'] === 'string' ? normalizeEmail(rec['email']) : '';
    const name = typeof rec['name'] === 'string' ? rec['name'] : '';
    const password = typeof rec['password'] === 'string' ? rec['password'] : '';
    if (!isEmail(email)) errors[`users.${i}.email`] = fieldEmailError;
    if (name.length < 1 || name.length > LIMITS.displayNameLength) errors[`users.${i}.name`] = fieldNameError;
    else if (hasControlChars(name)) errors[`users.${i}.name`] = fieldControlCharsError;
    if (password.length < 10) errors[`users.${i}.password`] = fieldPasswordError;
    userRows.push({ email, name, password });
  });
  const seenEmails = new Set<string>();
  userRows.forEach((u, i) => {
    if (seenEmails.has(u.email)) errors[`users.${i}.email`] = fieldEmailError;
    seenEmails.add(u.email);
  });
  const diagramRows: { title: string; owner: string; members: { email: string; role: Role }[]; document: Record<string, unknown> }[] = [];
  diagrams.forEach((d: unknown, i: number) => {
    const rec = (d ?? {}) as Record<string, unknown>;
    const title = typeof rec['title'] === 'string' ? rec['title'] : '';
    if (title.length < 1 || title.length > LIMITS.titleLength) errors[`diagrams.${i}.title`] = fieldTitleError;
    else if (hasControlChars(title)) errors[`diagrams.${i}.title`] = fieldControlCharsError;
    diagramRows.push({
      title,
      owner: typeof rec['owner'] === 'string' ? rec['owner'] : '',
      members: Array.isArray(rec['members']) ? rec['members'] as { email: string; role: Role }[] : [],
      document: (rec['document'] ?? {}) as Record<string, unknown>,
    });
  });
  if (Object.keys(errors).length > 0) throw invalid(errors);
  for (const u of userRows) {
    const existing = await ctx.db.query('SELECT id FROM users WHERE email = $1', [u.email]);
    if ((existing.rows.length ?? 0) > 0) throw new ApiError(409, 'email_taken', fieldEmailError);
  }
  const userIds = new Map<string, string>();
  for (const u of userRows) {
    const id = ctx.app.newId('u');
    userIds.set(u.email, id);
    await ctx.db.query(
      'INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)',
      [id, u.email, u.name, hashPassword(u.password)]);
  }
  const result = { users: [] as { id: string; email: string }[], diagrams: [] as unknown[] };
  for (const u of userRows) {
    result.users.push({ id: userIds.get(u.email)!, email: u.email });
  }
  for (const d of diagramRows) {
    const ownerId = userIds.get(normalizeEmail(d.owner));
    if (!ownerId) throw invalid({ owner: 'Unknown owner.' });
    const diagramId = ctx.app.newId('d');
    const doc = buildSeededDocument(ctx, diagramId, d.title, d.document);
    await ctx.db.query('INSERT INTO diagrams (id, title) VALUES ($1, $2)', [diagramId, d.title]);
    await ctx.db.query('INSERT INTO documents (diagram_id, content) VALUES ($1, $2)', [diagramId, JSON.stringify(doc)]);
    await ctx.db.query('INSERT INTO members (diagram_id, user_id, role) VALUES ($1, $2, $3)', [diagramId, ownerId, 'owner']);
    const pageMap: Record<string, unknown>[] = [];
    const layerIds = new Map<string, Map<string, string>>();
    const shapeIds = new Map<string, string>();
    const connectorIds = new Map<string, string>();
    const commentIds = new Map<string, string[]>();
    for (let pi = 0; pi < doc.pages.length; pi++) {
      const page = doc.pages[pi]!;
      const layerMap: Record<string, string> = {};
      for (const layer of page.layers) layerMap[layer.name] = layer.id;
      layerIds.set(page.name, new Map(Object.entries(layerMap)));
      const shapeMap: Record<string, string> = {};
      for (const shape of page.shapes) shapeMap[shape.label] = shape.id;
      for (const [label, id] of Object.entries(shapeMap)) shapeIds.set(label, id);
      const connectorMap: Record<string, string> = {};
      for (const connector of page.connectors) {
        const from = page.shapes.find((s) => s.id === connector.from.shape);
        const to = page.shapes.find((s) => s.id === connector.to.shape);
        connectorMap[`${from?.label}->${to?.label}`] = connector.id;
        connectorIds.set(`${from?.label}->${to?.label}`, connector.id);
      }
      const commentMap: Record<string, string[]> = {};
      const pageComments = await ctx.db.query(
        'SELECT id, shape_id FROM comments WHERE diagram_id = $1', [diagramId]);
      for (const row of pageComments.rows as { id: string; shape_id: string }[]) {
        const label = page.shapes.find((s) => s.id === row.shape_id)?.label;
        if (!label) continue;
        const list = commentMap[label] ?? [];
        list.push(row.id);
        commentMap[label] = list;
        const globalList = commentIds.get(label) ?? [];
        globalList.push(row.id);
        commentIds.set(label, globalList);
      }
      pageMap.push({ id: page.id, name: page.name, layers: layerMap, shapes: shapeMap, connectors: connectorMap, comments: commentMap });
    }
    for (const member of d.members) {
      const id = userIds.get(normalizeEmail(member.email));
      if (!id) continue;
      await ctx.db.query(
        'INSERT INTO members (diagram_id, user_id, role) VALUES ($1, $2, $3)', [diagramId, id, member.role]);
    }
    result.diagrams.push({ id: diagramId, pages: pageMap });
  }
  json(ctx.res, 201, result);
}

function buildSeededDocument(ctx: Ctx, id: string, title: string, spec: Record<string, unknown>): Document {
  const doc = newDocument(id, title);
  doc.pages = [];
  const pages = Array.isArray(spec['pages']) ? spec['pages'] as Record<string, unknown>[] : [];
  pages.forEach((pageSpec, pageIndex) => {
    const pageId = ctx.app.newId('p');
    const layers: { id: string; name: string; order: number; visible: boolean; locked: boolean }[] = [];
    const layerSpecs = Array.isArray(pageSpec['layers']) ? pageSpec['layers'] as Record<string, unknown>[] : [];
    layerSpecs.forEach((l, i) => {
      layers.push({
        id: ctx.app.newId('l'),
        name: String(l['name'] ?? `Layer ${i + 1}`),
        order: i,
        visible: l['visible'] !== false,
        locked: l['locked'] === true,
      });
    });
    if (layers.length === 0) {
      layers.push({ id: ctx.app.newId('l'), name: 'Layer 1', order: 0, visible: true, locked: false });
    }
    const page: Document['pages'][number] = {
      id: pageId,
      name: String(pageSpec['name'] ?? `Page ${pageIndex + 1}`),
      order: pageIndex,
      layers,
      shapes: [],
      connectors: [],
      groups: [],
    };
    const labelToId = new Map<string, string>();
    const shapeSpecs = Array.isArray(pageSpec['shapes']) ? pageSpec['shapes'] as Record<string, unknown>[] : [];
    shapeSpecs.forEach((s, i) => {
      const layerName = String(s['layer'] ?? layers[0]!.name);
      const layer = layers.find((l) => l.name === layerName) ?? layers[0]!;
      const shapeId = ctx.app.newId('s');
      const label = String(s['label'] ?? '');
      labelToId.set(label, shapeId);
      page.shapes.push({
        id: shapeId,
        kind: (s['kind'] as Document['pages'][number]['shapes'][number]['kind']) ?? 'rectangle',
        layer: layer.id,
        x: Number(s['x'] ?? 0), y: Number(s['y'] ?? 0),
        w: Number(s['w'] ?? 160), h: Number(s['h'] ?? 80),
        label, z: i + 1, group: null,
      });
    });
    const connectorSpecs = Array.isArray(pageSpec['connectors']) ? pageSpec['connectors'] as Record<string, unknown>[] : [];
    connectorSpecs.forEach((c) => {
      const fromLabel = String(((c['from'] as Record<string, unknown>)['shape'] ?? ''));
      const toLabel = String(((c['to'] as Record<string, unknown>)['shape'] ?? ''));
      const fromId = labelToId.get(fromLabel);
      const toId = labelToId.get(toLabel);
      if (!fromId || !toId) throw invalid({ connectors: 'Unknown shape label.' });
      const fromShape = page.shapes.find((sh) => sh.id === fromId)!;
      page.connectors.push({
        id: ctx.app.newId('c'),
        layer: fromShape.layer,
        from: { shape: fromId, port: ((c['from'] as Record<string, unknown>)['port'] as 'n' | 'e' | 's' | 'w') ?? 'e' },
        to: { shape: toId, port: ((c['to'] as Record<string, unknown>)['port'] as 'n' | 'e' | 's' | 'w') ?? 'w' },
        label: String(c['label'] ?? ''),
        route: [],
      });
    });
    const groupSpecs = Array.isArray(pageSpec['groups']) ? pageSpec['groups'] as Record<string, unknown>[] : [];
    for (const g of groupSpecs) {
      const members = Array.isArray(g['members']) ? g['members'] as string[] : [];
      const ids = members.map((m) => labelToId.get(m)).filter((v): v is string => v !== undefined);
      if (ids.length < 2) continue;
      const groupId = ctx.app.newId('g');
      page.groups.push({ id: groupId, members: ids });
      for (const id2 of ids) {
        const shape = page.shapes.find((sh) => sh.id === id2);
        if (shape) shape.group = groupId;
      }
    }
    doc.pages.push(page);
  });
  if (doc.pages.length === 0) {
    doc.pages.push(newDocument(id, title).pages[0]!);
  }
  rerouteDocument(doc);
  return doc;
}
