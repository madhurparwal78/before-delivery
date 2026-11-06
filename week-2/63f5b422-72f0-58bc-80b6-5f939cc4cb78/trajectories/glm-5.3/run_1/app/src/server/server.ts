// Plinth server: API, WebSocket, editor client, fonts and public pages on one port.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { config } from './config.js';
import { db, waitForDatabase } from './db.js';
import { HttpError, errorBody, notFound, forbiddenRole, conflictError, invalid } from './errors.js';
import * as auth from './auth.js';
import { newId, inviteToken, sessionToken, hashPassword, verifyPassword } from './ids.js';
import { getWorkspace, handleOperation, listOperations, memberRole, imageContext, saveDocument, newWorkspaceDocument } from './workspace.js';
import { applyOperation, findNodeEverywhere, findPageNode, cloneTreeWithNewIds, cloneStyles, defaultName, LIMITS } from './operations.js';
import { uploadImage, listImages, getImage, getImageBytes, storageStatus } from './images.js';
import { cutVersion, listVersions, getVersion, listThreads, createThread, getThread, addReply, setThreadStatus } from './versions.js';
import { publishPage, unpublishPage, publishStatus, serveSnapshot, serveAsset, pageMeta, cacheSnapshot, collectImageIds, ensurePagesTable } from './publish.js';
import { renderPublishedPage } from './render.js';
import { makeS3Call, snapshotKey, imageKey, setStorageOutage } from './s3.js';
import * as hub from './hub.js';
import { sendInviteMail, sendMentionMail } from './mail.js';
import { slugify, escapeHtml, type WorkspaceDocument, type DocumentNode, type Page, type Role } from '../shared/domain.js';
import type { UserRow } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, 'assets');

// ---------------------------------------------------------------------------
// request plumbing

interface Req {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  method: string;
  user: import('./types.js').UserRow | null;
  body?: unknown;
}

const JSON_LIMIT = 1_000_000;
const UPLOAD_LIMIT = 5_100_000;

function json(this: Req, status: number, body: unknown, extra?: Record<string, string>): void {
  const data = JSON.stringify(body);
  this.res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    ...extra,
  });
  this.res.end(data);
}

function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let rejected = false;
    req.on('data', (c: Buffer) => {
      if (rejected) return;
      size += c.length;
      if (size > limit) {
        rejected = true;
        reject(new HttpError(413, limit === JSON_LIMIT ? { code: 'body_too_large' } : { code: 'image_too_large' }));
        req.removeAllListeners('data');
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { if (!rejected) resolve(Buffer.concat(chunks)); });
    req.on('error', (err) => { if (!rejected) reject(err); });
  });
}

function sendError(r: { res: http.ServerResponse }, err: unknown): void {
  if (err instanceof HttpError) {
    const status = err.status;
    r.res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' });
    r.res.end(errorBody(err.err));
    return;
  }
  console.error('unhandled error:', err);
  r.res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
  r.res.end(JSON.stringify({ error: { code: 'internal', message: 'Something went wrong.' } }));
}

function sameOriginOk(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const o = new URL(origin);
    const host = req.headers.host ?? '';
    return o.host === host;
  } catch {
    return false;
  }
}

function isStateChanging(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}

// ---------------------------------------------------------------------------
// helpers

async function requireUser(r: Req): Promise<UserRow> {
  if (!r.user) throw new HttpError(401, { code: 'unauthenticated' });
  return r.user;
}

async function requireMember(r: Req, workspaceId: string): Promise<{ user: UserRow; role: Role }> {
  const user = await requireUser(r);
  const role = await memberRole(workspaceId, user.id);
  if (!role) throw notFound();
  return { user, role };
}

async function requireEditor(r: Req, workspaceId: string): Promise<{ user: UserRow; role: Role }> {
  const m = await requireMember(r, workspaceId);
  if (m.role === 'viewer') throw forbiddenRole();
  return m;
}

async function requireOwner(r: Req, workspaceId: string): Promise<{ user: UserRow; role: Role }> {
  const m = await requireMember(r, workspaceId);
  if (m.role !== 'owner') throw forbiddenRole();
  return m;
}

function parseJsonBody(raw: Buffer): unknown {
  const text = raw.toString('utf8');
  if (text.trim().length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw invalid({ body: 'The request body must be JSON.' });
  }
}

const PASSWORD_RE = /^.{10,}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fieldErrorSummary(fields: Record<string, string>): HttpError {
  return invalid(fields);
}

function setSessionCookie(res: http.ServerResponse, token: string): void {
  res.setHeader('set-cookie', auth.sessionCookieHeader(token));
}

function clearSessionCookie(res: http.ServerResponse): void {
  res.setHeader('set-cookie', auth.sessionCookieHeader('', true));
}

// ---------------------------------------------------------------------------
// workspace creation and lookup

async function createWorkspace(userId: string, name: unknown): Promise<{ id: string; name: string; slug: string; pages: { id: string; name: string; slug: string }[] }> {
  const n = typeof name === 'string' ? name.trim() : '';
  if (n.length < 1 || n.length > 80) throw invalid({ name: 'Workspace names are 1 to 80 characters.' });
  const id = newId('w');
  let slug = slugify(n);
  let suffix = 2;
  while (true) {
    const res = await db.query<{ id: string }>('SELECT id FROM workspaces WHERE slug = $1', [slug]);
    if (res.rows.length === 0) break;
    slug = `${slugify(n)}-${suffix++}`;
  }
  const doc = newWorkspaceDocument(n, slug);
  doc.id = id;
  const pageId = newId('pg');
  const nodeId = newId('n');
  doc.pages.push({
    id: pageId, name: 'Home', slug: 'home', order: 0,
    root: { id: nodeId, type: 'page', name: 'Home', props: {}, styles: {}, children: [] },
  });
  await db.query('INSERT INTO workspaces (id, name, slug, document, seq) VALUES ($1,$2,$3,$4,0)', [id, n, slug, JSON.stringify(doc)]);
  await db.query('INSERT INTO members (workspace_id, user_id, role) VALUES ($1,$2,\'owner\')', [id, userId]);
  await ensurePagesTable(id, doc);
  return { id, name: n, slug, pages: [{ id: pageId, name: 'Home', slug: 'home' }] };
}

async function workspaceSummary(userId: string): Promise<{ id: string; name: string; slug: string; role: Role }[]> {
  const res = await db.query<{ id: string; name: string; slug: string; role: Role }>(
    'SELECT w.id, w.name, w.slug, m.role FROM workspaces w JOIN members m ON m.workspace_id = w.id WHERE m.user_id = $1 ORDER BY w.created_at', [userId]);
  return res.rows;
}

async function firstPageId(workspaceId: string): Promise<string | null> {
  const ws = await getWorkspace(workspaceId);
  if (!ws) return null;
  return ws.document.pages[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// versions

async function doRestore(versionId: string, user: UserRow): Promise<{ version: { id: string; name: string; author: { id: string; name: string }; createdAt: string; seq: number }; seq: number; workspaceId: string; versionName: string }> {
  const version = await getVersion(versionId);
  if (!version) throw notFound();
  const role = await memberRole(version.document.id, user.id);
  if (!role || role === 'viewer') throw role ? forbiddenRole() : notFound();
  const ws = await getWorkspace(version.document.id);
  if (!ws) throw notFound();

  const restoredDoc: WorkspaceDocument = JSON.parse(JSON.stringify(version.document));
  const seq = ws.seq + 1;
  restoredDoc.seq = seq;
  await saveDocument(version.document.id, restoredDoc, seq);

  // one change-log entry for the restore; every other entry of this op is this restore
  await db.query(
    'INSERT INTO operations (workspace_id, seq, op_id, author_id, author_name, kind, op) VALUES ($1,$2,NULL,$3,$4,\'restore\', $5)',
    [version.document.id, seq, user.id, user.name, JSON.stringify({ kind: 'restore', versionId, versionName: version.name })]);
  const newVersion = await cutVersion(version.document.id, restoredDoc, `Restored ${version.name}`, user);
  await db.query('UPDATE publishes SET state = \'live_changed\' WHERE workspace_id = $1 AND state = \'live\'', [version.document.id]);
  return { version: newVersion, seq, workspaceId: version.document.id, versionName: version.name };
}

// ---------------------------------------------------------------------------
// comments and mentions

function extractMentions(body: string): string[] {
  const out: string[] = [];
  const re = /@([^\s@]+@[^\s@]+\.[^\s@]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out.push(m[1].toLowerCase());
  return out;
}

async function sendMentionMails(workspaceId: string, pageName: string, nodeName: string, body: string, author: UserRow): Promise<string[]> {
  const failed: string[] = [];
  for (const email of extractMentions(body)) {
    if (email === author.email.toLowerCase()) continue;
    const memberRes = await db.query<{ id: string; name: string; email: string }>(
      'SELECT u.id, u.name, u.email FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 AND lower(u.email) = $2',
      [workspaceId, email]);
    const member = memberRes.rows[0];
    if (!member) continue;
    try {
      await sendMentionMail({ to: member.email, byName: author.name, pageName, nodeName, body, pageId: '' });
    } catch {
      failed.push(member.email);
    }
  }
  return failed;
}

// ---------------------------------------------------------------------------
// API routing

async function apiRoute(r: Req): Promise<void> {
  const { method } = r;
  const parts = r.url.pathname.split('/').filter(Boolean); // ['api', ...]
  const p = parts.slice(1);
  const body = r.body as Record<string, unknown> | undefined;

  // health never fails and never needs auth
  if (r.url.pathname === '/api/health') {
    json.call(r, 200, { status: 'ok' });
    return;
  }

  // auth
  if (p[0] === 'auth') {
    if (p[1] === 'signup' && method === 'POST') {
      const name = body?.name, email = body?.email, password = body?.password;
      const fields: Record<string, string> = {};
      const n = typeof name === 'string' ? name.trim() : '';
      const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
      const pw = typeof password === 'string' ? password : '';
      if (n.length < 1 || n.length > 80) fields.name = 'Enter a name.';
      if (!EMAIL_RE.test(e)) fields.email = 'Enter an email address like name@example.org.';
      if (pw.length < 10) fields.password = 'Use 10 or more characters.';
      if (Object.keys(fields).length) throw fieldErrorSummary(fields);
      const existing = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [e]);
      if (existing.rows.length > 0) throw conflictError('email_taken', 'An account with this email already exists.');
      const user = await auth.createUser(n, e, pw);
      const token = await auth.createSession(user.id);
      setSessionCookie(r.res, token);
      json.call(r, 201, { user: { id: user.id, name: user.name, email: user.email } });
      return;
    }
    if (p[1] === 'signin' && method === 'POST') {
      const e = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
      const pw = typeof body?.password === 'string' ? body.password : '';
      const fields: Record<string, string> = {};
      if (!EMAIL_RE.test(e)) fields.email = 'Enter an email address like name@example.org.';
      if (pw.length < 1) fields.password = 'Enter your password.';
      if (Object.keys(fields).length) throw fieldErrorSummary(fields);
      const row = await auth.findUserByEmail(e);
      if (!row || !verifyPassword(pw, row.password_hash)) {
        throw new HttpError(401, { code: 'invalid_credentials', message: 'Email or password is wrong.' });
      }
      const token = await auth.createSession(row.id);
      setSessionCookie(r.res, token);
      json.call(r, 200, { user: { id: row.id, name: row.name, email: row.email } });
      return;
    }
    if (p[1] === 'signout' && method === 'POST') {
      const cookie = auth.readCookie(r.req.headers.cookie, 'pl_session');
      if (cookie) await auth.destroySession(cookie);
      clearSessionCookie(r.res);
      r.res.writeHead(204, { 'x-content-type-options': 'nosniff' });
      r.res.end();
      return;
    }
    throw notFound();
  }

  if (p[0] === 'me' && method === 'GET') {
    const user = await requireUser(r);
    const workspaces = await workspaceSummary(user.id);
    json.call(r, 200, { user: { id: user.id, name: user.name, email: user.email }, workspaces });
    return;
  }

  if (p[0] === 'workspaces' && method === 'POST' && p.length === 1) {
    const user = await requireUser(r);
    const created = await createWorkspace(user.id, body?.name);
    json.call(r, 201, created);
    return;
  }

  if (p[0] === 'workspaces' && p[1] && p[2] === 'document' && method === 'GET') {
    await requireMember(r, p[1]);
    const ws = await getWorkspace(p[1]);
    if (!ws) throw notFound();
    json.call(r, 200, ws.document);
    return;
  }

  if (p[0] === 'workspaces' && p[1] && p[2] === 'operations') {
    const workspaceId = p[1];
    await requireMember(r, workspaceId);
    if (method === 'POST' && p.length === 3) {
      const user = await requireUser(r);
      await requireEditor(r, workspaceId);
      const op = body as Record<string, unknown>;
      const outcome = await handleOperation({ workspaceId, userId: user.id, userName: user.name, op: op as never });
      const payload: Record<string, unknown> = { opId: op.opId, seq: outcome.seq };
      if (outcome.created) payload.created = outcome.created;
      if (outcome.conflictFor) {
        // notify the loser through their open sessions
        hub.broadcastWorkspace(workspaceId, {
          type: 'conflict', opId: outcome.conflictFor.userId, property: outcome.conflictFor.property,
          value: outcome.conflictFor.value, winner: { id: user.id, name: user.name },
        });
      }
      hub.broadcastWorkspace(workspaceId, {
        type: 'op', seq: outcome.seq, author: { id: user.id, name: user.name },
        op: { ...op, ...(outcome.created ?? {}) },
      }, user.id);
      json.call(r, 200, payload);
      return;
    }
    if (method === 'GET' && p.length === 3) {
      const since = Number(r.url.searchParams.get('since') ?? 0);
      const ops = await listOperations(workspaceId, Number.isFinite(since) ? since : 0);
      json.call(r, 200, { operations: ops });
      return;
    }
    throw notFound();
  }

  if (p[0] === 'workspaces' && p[1] && p[2] === 'images') {
    const workspaceId = p[1];
    await requireMember(r, workspaceId);
    if (method === 'GET' && p.length === 3) {
      const images = await listImages(workspaceId);
      json.call(r, 200, { images: images.map((i) => ({ id: i.id, status: 'confirmed', fileName: i.file_name, width: i.width, height: i.height })) });
      return;
    }
    if (method === 'POST' && p.length === 3) {
      if (!r.body || !(r.body as { __multipart?: Buffer }).__multipart) {
        throw invalid({ file: 'Uploads use multipart/form-data.' });
      }
      await handleMultipartUpload(r);
      return;
    }
    throw notFound();
  }

  if (p[0] === 'workspaces' && p[1] && p[2] === 'storage' && method === 'GET') {
    const workspaceId = p[1];
    await requireMember(r, workspaceId);
    const status = await storageStatus(workspaceId);
    json.call(r, 200, { status });
    return;
  }

  if (p[0] === 'workspaces' && p[1] && p[2] === 'versions') {
    const workspaceId = p[1];
    await requireMember(r, workspaceId);
    if (method === 'GET') {
      const versions = await listVersions(workspaceId);
      json.call(r, 200, { versions });
      return;
    }
    if (method === 'POST') {
      const user = await requireUser(r);
      await requireEditor(r, workspaceId);
      const name = body?.name;
      if (name !== undefined && (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 80)) {
        throw invalid({ name: 'Version names are 1 to 80 characters.' });
      }
      const ws = await getWorkspace(workspaceId);
      if (!ws) throw notFound();
      const version = await cutVersion(workspaceId, ws.document, typeof name === 'string' ? name.trim() : undefined, user);
      json.call(r, 201, version);
      return;
    }
    throw notFound();
  }

  if (p[0] === 'workspaces' && p[1] && p[2] === 'comments') {
    const workspaceId = p[1];
    await requireMember(r, workspaceId);
    if (method === 'GET') {
      const pageId = r.url.searchParams.get('pageId') ?? undefined;
      const threads = await listThreads(workspaceId, pageId);
      json.call(r, 200, { threads });
      return;
    }
    if (method === 'POST') {
      const user = await requireUser(r);
      await requireMember(r, workspaceId);
      const pageId = body?.pageId, nodeId = body?.nodeId, bodyText = body?.body;
      if (typeof pageId !== 'string' || typeof nodeId !== 'string' || typeof bodyText !== 'string' || bodyText.trim().length < 1 || bodyText.length > 2000) {
        throw invalid({ body: 'Comments are 1 to 2,000 characters.' });
      }
      const ws = await getWorkspace(workspaceId);
      if (!ws) throw notFound();
      if (!ws.document.pages.some((pg) => pg.id === pageId)) throw notFound();
      const node = findPageNode(ws.document, nodeId);
      const nodeName = node?.node.name ?? nodeId;
      const thread = await createThread(workspaceId, pageId, nodeId, nodeName, { id: user.id, name: user.name }, bodyText);
      const page = ws.document.pages.find((pg) => pg.id === pageId)!;
      const failed = await sendMentionMails(workspaceId, page.name, nodeName, bodyText, user);
      hub.broadcastWorkspace(workspaceId, { type: 'comment', thread }, user.id);
      json.call(r, 201, { ...thread, mentionMailFailed: failed.length > 0 ? failed : undefined });
      return;
    }
    throw notFound();
  }

  if (p[0] === 'workspaces' && p[1] && p[2] === 'members' && p.length === 3 && method === 'GET') {
    const workspaceId = p[1];
    await requireMember(r, workspaceId);
    const actives = await db.query<{ user_id: string; email: string; name: string; role: Role }>(
      'SELECT m.user_id, u.email, u.name, m.role FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 ORDER BY u.created_at', [workspaceId]);
    const invites = await db.query<{ id: string; email: string; role: string }>(
      'SELECT id, email, role FROM invitations WHERE workspace_id = $1 AND status = \'pending\' ORDER BY created_at', [workspaceId]);
    json.call(r, 200, {
      members: [
        ...invites.rows.map((i) => ({ inviteId: i.id, email: i.email, role: i.role, status: 'invited' })),
        ...actives.rows.map((a) => ({ userId: a.user_id, email: a.email, name: a.name, role: a.role, status: 'active' })),
      ],
    });
    return;
  }

  if (p[0] === 'workspaces' && p[1] && p[2] === 'members' && p[3] && (method === 'PATCH' || method === 'DELETE')) {
    const workspaceId = p[1];
    await requireOwner(r, workspaceId);
    const targetRes = await db.query<{ user_id: string; role: Role }>(
      'SELECT user_id, role FROM members WHERE workspace_id = $1 AND user_id = $2', [workspaceId, p[3]]);
    const target = targetRes.rows[0];
    if (!target) throw notFound();
    if (target.role === 'owner') throw conflictError('owner_role_fixed', "The owner's role cannot change.");
    if (method === 'PATCH') {
      const role = body?.role;
      if (role !== 'editor' && role !== 'viewer') throw invalid({ role: 'Roles are editor or viewer.' });
      await db.query('UPDATE members SET role = $1 WHERE workspace_id = $2 AND user_id = $3', [role, workspaceId, p[3]]);
      // notify the member's open sessions
      for (const s of hub.sessionsOf(workspaceId)) {
        if (s.userId === p[3]) {
          s.role = role;
          hub.send(s, { type: 'role', role });
          hub.broadcastWorkspace(workspaceId, { type: 'presence', people: presencePeople(workspaceId) });
        }
      }
      const userRes = await db.query<{ email: string; name: string }>('SELECT email, name FROM users WHERE id = $1', [p[3]]);
      json.call(r, 200, { userId: p[3], email: userRes.rows[0]?.email, name: userRes.rows[0]?.name, role, status: 'active' });
      return;
    }
    // DELETE
    await db.query('DELETE FROM members WHERE workspace_id = $1 AND user_id = $2', [workspaceId, p[3]]);
    for (const s of hub.sessionsOf(workspaceId)) {
      if (s.userId === p[3]) {
        s.closed = true;
        s.ws.close(4404, 'removed');
        hub.removeSession(s);
      }
    }
    r.res.writeHead(204, { 'x-content-type-options': 'nosniff' });
    r.res.end();
    return;
  }

  if (p[0] === 'workspaces' && p[1] && p[2] === 'invites' && method === 'POST') {
    const workspaceId = p[1];
    const owner = await requireOwner(r, workspaceId);
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const role = body?.role;
    const fields: Record<string, string> = {};
    if (!EMAIL_RE.test(email)) fields.email = 'Enter an email address like name@example.org.';
    if (role !== 'editor' && role !== 'viewer') fields.role = 'Roles are editor or viewer.';
    if (Object.keys(fields).length) throw fieldErrorSummary(fields);
    const member = await db.query<{ user_id: string }>(
      'SELECT user_id FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 AND lower(u.email) = $2', [workspaceId, email]);
    if (member.rows.length > 0) throw conflictError('already_member', `${email} is already a member.`);
    const pending = await db.query<{ id: string }>(
      'SELECT id FROM invitations WHERE workspace_id = $1 AND lower(email) = $2 AND status = \'pending\'', [workspaceId, email]);
    if (pending.rows.length > 0) throw conflictError('already_invited', `${email} already has an invitation.`);
    const id = newId('inv');
    const token = inviteToken();
    try {
      await sendInviteMail({ to: email, inviterName: owner.user.name, workspaceName: (await getWorkspace(workspaceId))!.name, role: role as 'editor' | 'viewer', token });
    } catch {
      throw new HttpError(503, { code: 'mail_unavailable' });
    }
    await db.query('INSERT INTO invitations (id, workspace_id, email, role, status, token) VALUES ($1,$2,$3,$4,\'pending\',$5)',
      [id, workspaceId, email, role, token]);
    json.call(r, 201, { inviteId: id, email, role, status: 'invited' });
    return;
  }

  if (p[0] === 'invites' && p[1] && method === 'DELETE') {
    const res = await db.query<{ workspace_id: string; status: string }>('SELECT workspace_id, status FROM invitations WHERE id = $1', [p[1]]);
    const inv = res.rows[0];
    if (!inv) throw notFound();
    await requireOwner(r, inv.workspace_id);
    if (inv.status !== 'pending') throw conflictError('not_pending', 'That invitation is no longer pending.');
    await db.query('UPDATE invitations SET status = \'revoked\' WHERE id = $1', [p[1]]);
    r.res.writeHead(204, { 'x-content-type-options': 'nosniff' });
    r.res.end();
    return;
  }

  if (p[0] === 'invites' && p[1] && p[2] === 'accept' && method === 'POST') {
    const token = p[1];
    const user = await requireUser(r);
    const res = await db.query<{ id: string; workspace_id: string; email: string; role: string; status: string }>(
      'SELECT id, workspace_id, email, role, status FROM invitations WHERE token = $1', [token]);
    const inv = res.rows[0];
    if (!inv || inv.status !== 'pending' || inv.email !== user.email.toLowerCase()) {
      throw new HttpError(404, { code: 'invite_invalid', message: 'This invitation isn\'t valid.' });
    }
    await db.query('UPDATE invitations SET status = \'accepted\' WHERE id = $1', [inv.id]);
    await db.query('INSERT INTO members (workspace_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [inv.workspace_id, user.id, inv.role]);
    const pageId = await firstPageId(inv.workspace_id);
    json.call(r, 200, {
      workspaceId: inv.workspace_id, role: inv.role,
      redirect: `/w/${inv.workspace_id}/edit${pageId ? `?page=${pageId}` : ''}`,
    });
    return;
  }

  if (p[0] === 'images' && p[1] && method === 'GET' && p.length === 2) {
    const imageId = p[1];
    const user = await requireUser(r);
    const rec = await getImage(imageId);
    if (!rec) throw notFound();
    const role = await memberRole(rec.workspace_id, user.id);
    if (!role) throw notFound();
    try {
      const bytes = await getImageBytes(rec);
      r.res.writeHead(200, { 'content-type': rec.content_type, 'x-content-type-options': 'nosniff' });
      r.res.end(bytes);
    } catch {
      throw new HttpError(503, { code: 'storage_unavailable' });
    }
    return;
  }

  if (p[0] === 'pages' && p[1] && p[2] === 'publish') {
    const pageId = p[1];
    const meta = await pageMeta(pageId);
    if (!meta) {
      // page might exist but never have been published; look it up
      const ownerRes = await db.query<{ workspace_id: string }>('SELECT workspace_id FROM published_pages WHERE id = $1', [pageId]);
      if (!ownerRes.rows[0]) throw notFound();
    }
    if (method === 'GET') {
      await requireMember(r, (await pageWorkspaceId(pageId)));
      const status = await publishStatus(pageId);
      json.call(r, 200, status);
      return;
    }
    if (method === 'POST') {
      const user = await requireUser(r);
      const workspaceId = await pageWorkspaceId(pageId);
      await requireEditor(r, workspaceId);
      const key = r.req.headers['idempotency-key'];
      const status = await publishPage(workspaceId, pageId, typeof key === 'string' ? key : undefined, user.id, user.name);
      json.call(r, 201, status);
      return;
    }
    if (method === 'DELETE') {
      throw notFound();
    }
    throw notFound();
  }

  if (p[0] === 'pages' && p[1] && p[2] === 'unpublish' && method === 'POST') {
    const pageId = p[1];
    const workspaceId = await pageWorkspaceId(pageId);
    await requireOwner(r, workspaceId);
    const status = await unpublishPage(pageId);
    json.call(r, 200, status);
    return;
  }

  if (p[0] === 'versions' && p[1] && p.length === 2 && method === 'GET') {
    const user = await requireUser(r);
    const version = await getVersion(p[1]);
    if (!version) throw notFound();
    const role = await memberRole(version.document.id, user.id);
    if (!role) throw notFound();
    json.call(r, 200, { ...version, workspaceId: version.document.id });
    return;
  }

  if (p[0] === 'versions' && p[1] && p[2] === 'restore' && method === 'POST') {
    const user = await requireUser(r);
    const result = await doRestore(p[1], user);
    hub.broadcastWorkspace(result.workspaceId, {
      type: 'restored', by: { id: user.id, name: user.name }, versionName: result.versionName, seq: result.seq,
    });
    json.call(r, 201, { version: result.version, seq: result.seq });
    return;
  }

  if (p[0] === 'comments' && p[1] && p[2] === 'replies' && method === 'POST') {
    const user = await requireUser(r);
    const thread = await getThread(p[1]);
    if (!thread) throw notFound();
    const workspaceId = (await db.query<{ workspace_id: string }>('SELECT workspace_id FROM comments WHERE id = $1', [p[1]])).rows[0]?.workspace_id;
    if (!workspaceId) throw notFound();
    await requireMember(r, workspaceId);
    const text = body?.body;
    if (typeof text !== 'string' || text.trim().length < 1 || text.length > 2000) {
      throw invalid({ body: 'Replies are 1 to 2,000 characters.' });
    }
    const reply = await addReply(p[1], { id: user.id, name: user.name }, text);
    const ws = await getWorkspace(workspaceId);
    const pageName = ws?.document.pages.find((pg) => pg.id === thread.pageId)?.name ?? '';
    const failed = await sendMentionMails(workspaceId, pageName, thread.nodeName, text, user);
    const updated = await getThread(p[1]);
    hub.broadcastWorkspace(workspaceId, { type: 'comment', thread: updated }, user.id);
    json.call(r, 201, { reply, mentionMailFailed: failed.length > 0 ? failed : undefined });
    return;
  }

  if (p[0] === 'comments' && p[1] && (p[2] === 'resolve' || p[2] === 'reopen') && method === 'POST') {
    const user = await requireUser(r);
    const thread = await getThread(p[1]);
    if (!thread) throw notFound();
    const workspaceIdRow = (await db.query<{ workspace_id: string; author_id: string }>('SELECT workspace_id, author_id FROM comments WHERE id = $1', [p[1]])).rows[0];
    if (!workspaceIdRow) throw notFound();
    const role = await requireMember(r, workspaceIdRow.workspace_id);
    const resolving = p[2] === 'resolve';
    if (resolving && thread.status === 'resolved') throw conflictError('already_resolved', 'That thread is already resolved.');
    if (!resolving && thread.status === 'open') throw conflictError('not_resolved', 'That thread is not resolved.');
    if (role.role === 'viewer' && thread.author.id !== user.id) throw forbiddenRole();
    await setThreadStatus(p[1], resolving ? 'resolved' : 'open');
    const updated = await getThread(p[1]);
    hub.broadcastWorkspace(workspaceIdRow.workspace_id, { type: 'comment', thread: updated }, user.id);
    json.call(r, 200, updated);
    return;
  }

  // grading routes
  if (p[0] === 'grading' && config.gradingRoutes) {
    if (p[1] === 'seed' && method === 'POST') {
      const result = await gradingSeed(body);
      json.call(r, 201, result);
      return;
    }
    if (p[1] === 'storage-outage' && method === 'POST') {
      const workspaceId = body?.workspaceId;
      const ms = body?.ms;
      if (typeof workspaceId !== 'string' || typeof ms !== 'number') throw invalid({ workspaceId: 'workspaceId and ms are required.' });
      setStorageOutage(workspaceId, ms);
      json.call(r, 200, { status: 'ok' });
      return;
    }
    throw notFound();
  }

  throw notFound();
}

async function pageWorkspaceId(pageId: string): Promise<string> {
  const meta = await pageMeta(pageId);
  if (meta) return meta.workspaceId;
  const res = await db.query<{ document: WorkspaceDocument }>('SELECT document FROM workspaces', []);
  for (const row of res.rows) {
    if (row.document.pages.some((p) => p.id === pageId)) {
      await ensurePagesTable(row.document.id, row.document);
      return row.document.id;
    }
  }
  throw notFound();
}

async function workspaceIdOfInvite(inviteId: string): Promise<string> {
  const res = await db.query<{ workspace_id: string }>('SELECT workspace_id FROM invitations WHERE id = $1', [inviteId]);
  if (!res.rows[0]) throw notFound();
  return res.rows[0].workspace_id;
}

function presencePeople(workspaceId: string): { id: string; name: string; role: string }[] {
  const seen = new Set<string>();
  const people: { id: string; name: string; role: string }[] = [];
  for (const s of hub.sessionsOf(workspaceId)) {
    if (seen.has(s.userId)) continue;
    seen.add(s.userId);
    people.push({ id: s.userId, name: s.name, role: s.role });
  }
  return people;
}

// ---------------------------------------------------------------------------
// grading seed (only when GRADING_ROUTES=on)

interface SeedNodeSpec {
  type: string; name: string; props?: Record<string, unknown>;
  styles?: Record<string, Record<string, unknown>>;
  children?: SeedNodeSpec[];
  shared?: { component: string };
  bind?: Record<string, string>;
}

interface SeedDoc {
  tokens?: { name: string; kind: 'color' | 'size'; value: string | number; unit?: string }[];
  pages?: { name: string; root?: SeedNodeSpec }[];
  components?: { name: string; root: SeedNodeSpec }[];
  collection?: { name?: string; fields?: { name: string; kind: string }[]; entries?: { values: Record<string, unknown> }[] };
}

function makeNode(spec: SeedNodeSpec, idMap: Map<string, string>): DocumentNode {
  const id = newId('n');
  idMap.set(spec.name, id);
  const node: DocumentNode = {
    id, type: spec.type as DocumentNode['type'], name: spec.name,
    props: spec.props ? { ...spec.props } : {},
    styles: {},
    children: (spec.children ?? []).map((c) => makeNode(c, idMap)),
  };
  for (const [bp, styles] of Object.entries(spec.styles ?? {})) {
    node.styles[bp as 'desktop'] = {};
    for (const [k, v] of Object.entries(styles)) {
      node.styles[bp as 'desktop']![k] = v as never;
    }
  }
  if (spec.bind) node.bind = { ...spec.bind };
  return node;
}

async function gradingSeed(body: unknown): Promise<unknown> {
  const spec = body as { users?: { email: string; name: string; password: string }[]; workspaces?: { name: string; owner: string; members?: { email: string; role: string }[]; document?: SeedDoc; published?: string[] }[] };
  if (!spec || typeof spec !== 'object') throw invalid({ body: 'Seed body is invalid.' });
  const usersOut: { id: string; email: string }[] = [];
  const byEmail = new Map<string, UserRow>();
  for (const u of spec.users ?? []) {
    if (typeof u.email !== 'string' || typeof u.name !== 'string' || typeof u.password !== 'string') {
      throw invalid({ users: 'Each user needs email, name and password.' });
    }
    const existing = await auth.findUserByEmail(u.email.toLowerCase());
    const user = existing ?? await auth.createUser(u.name, u.email.toLowerCase(), u.password);
    byEmail.set(u.email.toLowerCase(), user);
    usersOut.push({ id: user.id, email: user.email });
  }

  const workspacesOut: unknown[] = [];
  for (const w of spec.workspaces ?? []) {
    const owner = byEmail.get(w.owner.toLowerCase());
    if (!owner) throw invalid({ workspaces: `Owner ${w.owner} is not in users.` });
    const created = await createWorkspace(owner.id, w.name);
    const ws = (await getWorkspace(created.id))!;
    const doc = ws.document;
    const docSpec = w.document ?? {};

    if (docSpec.tokens) {
      doc.tokens = docSpec.tokens.map((t) => ({ name: t.name, kind: t.kind, value: t.value, ...(t.unit ? { unit: t.unit as 'px' | 'rem' } : {}) }));
    }

    const nodeIds = new Map<string, string>();
    // components first (linked instances reference them by name)
    const componentIds = new Map<string, string>();
    for (const comp of docSpec.components ?? []) {
      const componentId = newId('cp');
      componentIds.set(comp.name, componentId);
      const root = makeNode(comp.root, nodeIds);
      doc.components.push({ id: componentId, name: comp.name, root });
    }

    doc.pages = [];
    for (const [i, pageSpec] of (docSpec.pages ?? [{ name: 'Home' }]).entries()) {
      const pageId = newId('pg');
      let slug = slugify(pageSpec.name);
      let suffix = 2;
      while (doc.pages.some((p) => p.slug === slug)) slug = `${slugify(pageSpec.name)}-${suffix++}`;
      const rootSpec: SeedNodeSpec = pageSpec.root ?? { type: 'page', name: pageSpec.name, children: [] };
      const root = makeNode({ ...rootSpec, type: 'page', name: pageSpec.name }, nodeIds);
      doc.pages.push({ id: pageId, name: pageSpec.name, slug, order: i, root });
    }

    // linked instances
    for (const page of doc.pages) {
      const walk = (node: DocumentNode) => {
        const specNode = findSpecNode(docSpec, node.name);
        if (specNode?.shared?.component) {
          const componentId = componentIds.get(specNode.shared.component);
          if (!componentId) throw invalid({ document: `Component ${specNode.shared.component} is not defined.` });
          const comp = doc.components.find((c) => c.id === componentId)!;
          node.shared = { componentId };
          node.type = comp.root.type;
          node.props = { ...comp.root.props };
          node.styles = cloneStyles(comp.root.styles);
          const oldIds = node.children.map((c) => c.id);
          node.children = comp.root.children.map((c) => {
            const copy = cloneTreeWithNewIds(c);
            return copy;
          });
        }
        for (const c of node.children) walk(c);
      };
      walk(page.root);
    }

    if (docSpec.collection) {
      doc.collection.name = docSpec.collection.name ?? 'Entries';
      doc.collection.fields = (docSpec.collection.fields ?? []).map((f) => ({ name: f.name, kind: f.kind as 'text' }));
      doc.collection.entries = (docSpec.collection.entries ?? []).map((e) => ({
        id: newId('e'), order: 0, values: Object.fromEntries(Object.entries(e.values).map(([k, v]) => [k, typeof v === 'string' ? v : String(v)])),
      }));
      doc.collection.entries.forEach((e, i) => { e.order = i; });
    }

    // members
    for (const m of w.members ?? []) {
      const u = byEmail.get(m.email.toLowerCase());
      if (!u) throw invalid({ workspaces: `Member ${m.email} is not in users.` });
      if (u.id === owner.id) continue;
      if (m.role !== 'editor' && m.role !== 'viewer') throw invalid({ members: 'Roles are editor or viewer.' });
      await db.query('INSERT INTO members (workspace_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [created.id, u.id, m.role]);
    }

    await saveDocument(created.id, doc, doc.seq);
    await ensurePagesTable(created.id, doc);

    const pagesOut: { id: string; name: string; slug: string; nodes: Record<string, string> }[] = [];
    for (const page of doc.pages) {
      const nodes: Record<string, string> = {};
      const walk = (n: DocumentNode) => { nodes[n.name] = n.id; n.children.forEach(walk); };
      walk(page.root);
      pagesOut.push({ id: page.id, name: page.name, slug: page.slug, nodes });
    }
    const componentsOut: Record<string, string> = {};
    for (const comp of doc.components) componentsOut[comp.name] = comp.id;

    // publish requested pages
    for (const pageName of w.published ?? []) {
      const page = doc.pages.find((p) => p.name === pageName);
      if (!page) throw invalid({ published: `Page ${pageName} does not exist.` });
      try {
        await publishPage(created.id, page.id, undefined, owner.id, owner.name);
      } catch (err) {
        // publishing may fail if storage is down; seed still succeeds
        void err;
      }
    }

    workspacesOut.push({ id: created.id, slug: created.slug, pages: pagesOut, components: componentsOut });
  }

  return { users: usersOut, workspaces: workspacesOut };
}

function findSpecNode(docSpec: SeedDoc, name: string): SeedNodeSpec | null {
  for (const page of docSpec.pages ?? []) {
    const found = findInSpec(page.root, name);
    if (found) return found;
  }
  for (const comp of docSpec.components ?? []) {
    const found = findInSpec(comp.root, name);
    if (found) return found;
  }
  return null;
}

function findInSpec(node: SeedNodeSpec | undefined, name: string): SeedNodeSpec | null {
  if (!node) return null;
  if (node.name === name) return node;
  for (const c of node.children ?? []) {
    const f = findInSpec(c, name);
    if (f) return f;
  }
  return null;
}

// ---------------------------------------------------------------------------
// browser pages

function page(title: string, body: string, extraHead = ''): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/assets/app.css">
${extraHead}
</head>
<body class="ground">
${body}
</body>
</html>`;
}

function notFoundPage(): string {
  return page('Not found.', `<main class="center-card"><h1>Not found.</h1><p>It may have been removed, or you may not have access.</p></main>`);
}

function inviteInvalidPage(): string {
  return page('This invitation isn\'t valid.', `<main class="center-card"><h1>This invitation isn't valid.</h1><p>Ask whoever invited you to send a new one.</p></main>`);
}

function publicNotFoundPage(): string {
  return page('This page isn\'t published.', `<main class="center-card"><h1>This page isn't published.</h1><p>Check the address or ask the site's owner.</p></main>`);
}

function publicUnavailablePage(): string {
  return page('This page is temporarily unavailable.', `<main class="center-card"><h1>This page is temporarily unavailable.</h1><p>Please try again in a few minutes.</p></main>`);
}

function accountForm(kind: 'signup' | 'signin', next: string): string {
  const isSignup = kind === 'signup';
  const fields = isSignup
    ? `<label class="field"><span>Name</span><input type="text" id="f-name" name="name" autocomplete="name"></label>
       <label class="field"><span>Email</span><input type="email" id="f-email" name="email" autocomplete="email"></label>
       <label class="field"><span>Password</span><input type="password" id="f-password" name="password" autocomplete="new-password"></label>`
    : `<label class="field"><span>Email</span><input type="email" id="f-email" name="email" autocomplete="email"></label>
       <label class="field"><span>Password</span><input type="password" id="f-password" name="password" autocomplete="current-password"></label>`;
  return page(isSignup ? 'Sign up' : 'Sign in', `
<main class="center-card">
  <div id="error-summary" class="error-summary" hidden></div>
  <h1>${isSignup ? 'Sign up' : 'Sign in'}</h1>
  <form id="account-form" data-kind="${kind}" data-next="${escapeHtml(next)}">
    ${fields}
    <button type="submit" class="primary">${isSignup ? 'Sign up' : 'Sign in'}</button>
  </form>
  <p><a href="${isSignup ? '/signin' : '/signup'}">${isSignup ? 'Sign in instead' : 'Sign up instead'}</a></p>
</main>
<script src="/assets/account.js" defer></script>`);
}

// ---------------------------------------------------------------------------
// static assets

const MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.html': 'text/html; charset=utf-8',
};

const FORBIDDEN_PATTERNS = [
  /^\/run\.json$/, /^\/package(-lock)?\.json$/, /^\/\.env/, /^\/node_modules\//, /^\/src\//, /^\/esbuild\.mjs$/, /\.map$/, /^\/tsconfig\.json$/, /^\/THIRD_PARTY_NOTICES\.md$/, /^\/AGENTS\.md$/,
];

function isForbiddenPath(pathname: string): boolean {
  return FORBIDDEN_PATTERNS.some((re) => re.test(pathname));
}

function serveFile(res: http.ServerResponse, filePath: string): boolean {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': mime, 'x-content-type-options': 'nosniff', 'cache-control': 'no-cache' });
  res.end(fs.readFileSync(filePath));
  return true;
}

// ---------------------------------------------------------------------------
// main request handler

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const method = req.method ?? 'GET';
    const r: Req = { req, res, url, method, user: null };

    // same-origin rule for state-changing requests
    if (isStateChanging(method) && !sameOriginOk(req) && !url.pathname.startsWith('/api/grading/')) {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' });
      res.end(errorBody({ code: 'cross_origin' }));
      return;
    }

    r.user = await auth.userFromRequest(req);

    // API
    if (url.pathname.startsWith('/api/')) {
      // parse body
      const contentType = req.headers['content-type'] ?? '';
      if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
        try {
          if (contentType.includes('multipart/form-data')) {
            const raw = await readBody(req, UPLOAD_LIMIT);
            r.body = { __multipart: raw, __contentType: contentType, __boundary: extractBoundary(contentType) };
          } else {
            const raw = await readBody(req, JSON_LIMIT);
            r.body = parseJsonBody(raw);
          }
        } catch (err) {
          if (err instanceof HttpError) {
            res.writeHead(err.status, { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' });
            res.end(errorBody(err.err));
            return;
          }
          throw err;
        }
      }
      try {
        await apiRoute(r);
      } catch (err) {
        sendError(r, err);
      }
      return;
    }

    // browser routes
    if (isStateChanging(method) && method !== 'HEAD' && !sameOriginOk(req)) {
      res.writeHead(403, { 'content-type': 'text/html' });
      res.end('Forbidden');
      return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405);
      res.end();
      return;
    }

    // static assets
    if (url.pathname.startsWith('/assets/')) {
      const rel = url.pathname.slice('/assets/'.length);
      if (rel.includes('..') || isForbiddenPath(url.pathname)) {
        res.writeHead(404, { 'x-content-type-options': 'nosniff' });
        res.end(notFoundPage());
        return;
      }
      if (serveFile(res, path.join(ASSETS_DIR, rel))) return;
      res.writeHead(404, { 'x-content-type-options': 'nosniff' });
      res.end(notFoundPage());
      return;
    }

    if (isForbiddenPath(url.pathname)) {
      res.writeHead(404, { 'x-content-type-options': 'nosniff' });
      res.end(notFoundPage());
      return;
    }

    // public published pages
    if (url.pathname.startsWith('/p/')) {
      if (url.pathname === '/p/plinth-menu.js') {
        if (serveFile(res, path.join(ASSETS_DIR, 'plinth-menu.js'))) return;
        res.writeHead(404, { 'x-content-type-options': 'nosniff' });
        res.end(publicNotFoundPage());
        return;
      }
      await servePublic(url, res);
      return;
    }

    // account pages
    if (url.pathname === '/signup' || url.pathname === '/signin') {
      if (!r.user) {
        const next = safeNext(url.searchParams.get('next')) ?? '/';
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff' });
        res.end(accountForm(url.pathname === '/signup' ? 'signup' : 'signin', next));
        return;
      }
      res.writeHead(302, { location: safeNext(url.searchParams.get('next')) || '/' });
      res.end();
      return;
    }

    if (url.pathname === '/') {
      if (!r.user) {
        res.writeHead(302, { location: '/signin?next=/' });
        res.end();
        return;
      }
      const workspaces = await workspaceSummary(r.user.id);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff' });
      res.end(page('Workspaces', `
<main class="center-card wide">
  <h1>Workspaces</h1>
  <ul id="workspace-list" class="workspace-list">
    ${workspaces.map((w) => `<li><a href="/w/${w.id}/edit">${escapeHtml(w.name)}</a><span class="muted">${w.role}</span></li>`).join('')}
  </ul>
  <form id="create-workspace">
    <label class="field"><span>Workspace name</span><input type="text" id="f-ws-name" name="name"></label>
    <button type="submit" class="primary">Create workspace</button>
  </form>
</main>
<script src="/assets/home.js" defer></script>`));
      return;
    }

    // invite acceptance page
    if (url.pathname.startsWith('/invites/')) {
      const token = url.pathname.slice('/invites/'.length);
      if (!r.user) {
        res.writeHead(302, { location: `/signin?next=${encodeURIComponent(url.pathname)}` });
        res.end();
        return;
      }
      // accept server-side, then redirect
      const res2 = await db.query<{ id: string; workspace_id: string; email: string; role: string; status: string }>(
        'SELECT id, workspace_id, email, role, status FROM invitations WHERE token = $1', [token]);
      const inv = res2.rows[0];
      const invalidAccess = !inv || inv.status !== 'pending' || inv.email !== r.user.email.toLowerCase();
      if (invalidAccess) {
        res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff' });
        res.end(inviteInvalidPage());
        return;
      }
      await db.query('UPDATE invitations SET status = \'accepted\' WHERE id = $1', [inv.id]);
      await db.query('INSERT INTO members (workspace_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [inv.workspace_id, r.user.id, inv.role]);
      const pageId = await firstPageId(inv.workspace_id);
      res.writeHead(302, { location: `/w/${inv.workspace_id}/edit${pageId ? `?page=${pageId}` : ''}` });
      res.end();
      return;
    }

    // editor
    if (url.pathname.startsWith('/w/')) {
      if (!r.user) {
        res.writeHead(302, { location: `/signin?next=${encodeURIComponent(url.pathname + url.search)}` });
        res.end();
        return;
      }
      const parts = url.pathname.split('/').filter(Boolean); // ['w', id, 'edit']
      const workspaceId = parts[1];
      const role = await memberRole(workspaceId, r.user.id);
      if (!role) {
        res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff' });
        res.end(notFoundPage());
        return;
      }
      const ws = await getWorkspace(workspaceId);
      if (!ws) {
        res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff' });
        res.end(notFoundPage());
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff' });
      res.end(editorShell(ws, role, r.user, url.searchParams));
      return;
    }

    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff' });
    res.end(notFoundPage());
  } catch (err) {
    console.error('request error', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
      res.end('Something went wrong.');
    } else {
      res.end();
    }
  }
});

function safeNext(next: string | null): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return null;
  return next;
}

function extractBoundary(contentType: string): string {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  return m ? (m[1] ?? m[2]) : '';
}

async function servePublic(url: URL, res: http.ServerResponse): Promise<void> {
  // /p/<wsSlug>/<pageSlug>[/assets/<imageId>]
  const parts = url.pathname.split('/').filter(Boolean); // ['p', wsSlug, pageSlug, ...]
  if (parts.length < 3) {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff' });
    res.end(publicNotFoundPage());
    return;
  }
  const wsSlug = parts[1];
  const pageSlug = parts[2];
  const wsRes = await db.query<{ id: string }>('SELECT id FROM workspaces WHERE slug = $1', [wsSlug]);
  const workspaceId = wsRes.rows[0]?.id;
  if (!workspaceId) {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff' });
    res.end(publicNotFoundPage());
    return;
  }
  const pageRes = await db.query<{ id: string }>('SELECT id FROM published_pages WHERE workspace_id = $1 AND slug = $2', [workspaceId, pageSlug]);
  const pageId = pageRes.rows[0]?.id;
  if (!pageId) {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff' });
    res.end(publicNotFoundPage());
    return;
  }
  const status = await publishStatus(pageId);
  if (status.state !== 'live' && status.state !== 'live_changed') {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff' });
    res.end(publicNotFoundPage());
    return;
  }

  // asset?
  if (parts[3] === 'assets' && parts[4]) {
    try {
      const asset = await serveAsset(pageId, status.publishId!, parts[4]);
      if (!asset) {
        res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff' });
        res.end(publicNotFoundPage());
        return;
      }
      res.writeHead(200, { 'content-type': asset.contentType, 'x-content-type-options': 'nosniff' });
      res.end(asset.bytes);
      return;
    } catch {
      res.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff' });
      res.end(publicUnavailablePage());
      return;
    }
  }

  if (parts.length > 3) {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff' });
    res.end(publicNotFoundPage());
    return;
  }

  try {
    const snap = await serveSnapshot(pageId, status.publishId!);
    if (!snap) {
      res.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff' });
      res.end(publicUnavailablePage());
      return;
    }
    res.writeHead(200, { 'content-type': snap.contentType, 'x-content-type-options': 'nosniff' });
    res.end(snap.bytes);
  } catch {
    res.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff' });
    res.end(publicUnavailablePage());
  }
}

// ---------------------------------------------------------------------------
// editor shell

function editorShell(
  ws: { id: string; name: string; slug: string },
  role: Role,
  user: UserRow,
  params: URLSearchParams,
): string {
  const pageId = params.get('page');
  const bp = params.get('bp') ?? 'desktop';
  const panel = params.get('panel');
  const versionId = params.get('version');
  const isOwner = role === 'owner';
  const canEdit = role === 'owner' || role === 'editor';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(ws.name)}</title>
<link rel="stylesheet" href="/assets/app.css">
<link rel="stylesheet" href="/assets/editor.css">
</head>
<body>
<div id="editor" data-workspace-id="${ws.id}" data-workspace-name="${escapeHtml(ws.name)}" data-role="${role}"
     data-user-id="${user.id}" data-user-name="${escapeHtml(user.name)}" data-page-id="${pageId ?? ''}"
     data-bp="${bp}" data-panel="${panel ?? ''}" data-version="${versionId ?? ''}"
     data-can-edit="${canEdit}" data-is-owner="${isOwner}">
  <header role="banner" id="top-bar">
    <span class="ws-name">${escapeHtml(ws.name)}</span>
    <label class="combo"><span class="visually-hidden">Page</span><input id="page-select" role="combobox" aria-label="Page" autocomplete="off" readonly></label>
    <div role="radiogroup" aria-label="Breakpoint" id="bp-group">
      <label><input type="radio" name="bp" value="desktop" aria-label="Desktop 1280" ${(bp === 'desktop' ? 'checked' : '')}>Desktop 1280</label>
      <label><input type="radio" name="bp" value="tablet" aria-label="Tablet 768" ${(bp === 'tablet' ? 'checked' : '')}>Tablet 768</label>
      <label><input type="radio" name="bp" value="phone" aria-label="Phone 375" ${(bp === 'phone' ? 'checked' : '')}>Phone 375</label>
    </div>
    <div class="top-actions" id="edit-tools">
      <button id="btn-add" aria-haspopup="menu">Add</button>
      <button id="btn-tokens">Tokens</button>
      <button id="btn-collection">Collection</button>
      <button id="btn-images">Images</button>
      <button id="btn-history">History</button>
      <button id="btn-save-version">Save version</button>
      <button id="btn-comments">Comments</button>
      ${isOwner ? '<button id="btn-share">Share</button>' : ''}
      <button id="btn-publish">Publish</button>
    </div>
    <button id="btn-fan" disabled>Fan</button>
    <button id="btn-style-panel" aria-expanded="true" aria-controls="style-panel">Style panel</button>
    <button id="btn-navigator" aria-expanded="false" aria-controls="navigator">Navigator</button>
    <div id="presence" class="presence"></div>
  </header>
  <div id="layout">
    <nav id="navigator" aria-label="Navigator" role="tree"></nav>
    <div id="canvas-wrap">
      <div id="mode-banner" hidden></div>
      <div id="preview-banner" hidden></div>
      <div id="canvas" role="region" aria-label="Canvas" tabindex="0"></div>
    </div>
    <aside id="style-panel" role="complementary" aria-label="Style" data-motion="open" data-progress="1"></aside>
    <div id="sheet" hidden></div>
  </div>
  <div id="menus"></div>
  <div id="dialogs"></div>
  <div id="pins"></div>
  <div id="cursors"></div>
  <div id="storage-banner" role="alert" hidden></div>
  <div id="announcer" role="status" aria-live="polite" data-announcement-count="0"></div>
  <div id="toast" data-toast aria-hidden="true" hidden></div>
  <div id="phone-toolbar" role="toolbar" aria-label="Preview tools" hidden>
    <button id="pt-comments">Comments</button>
    <button id="pt-pages">Pages</button>
    <button id="pt-publish">Publish status</button>
  </div>
</div>
<script src="/assets/editor.js" defer></script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// WebSocket

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', async (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname !== '/ws' || !sameOriginOk(req)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  const user = await auth.userFromRequest(req);
  if (!user) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  const workspaceId = url.searchParams.get('workspace') ?? '';
  const role = await memberRole(workspaceId, user.id);
  if (!role) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const session: hub.Session = {
      ws, workspaceId, userId: user.id, name: user.name, role,
      pageId: null, cursor: null, lastHeartbeat: Date.now(), closed: false,
    };
    hub.addSession(session);
    ws.on('message', async (data) => {
      hub.heartbeat(session);
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      await handleSocketMessage(session, msg);
    });
    ws.on('close', () => {
      session.closed = true;
      hub.removeSession(session);
      hub.broadcastWorkspace(workspaceId, { type: 'presence', people: presencePeople(workspaceId) });
    });
    ws.on('pong', () => hub.heartbeat(session));
    // hello
    getWorkspace(workspaceId).then((w) => {
      hub.send(session, { type: 'hello', seq: w?.seq ?? 0, you: { id: user.id, name: user.name, role } });
      hub.broadcastWorkspace(workspaceId, { type: 'presence', people: presencePeople(workspaceId) }, session.userId);
      hub.send(session, { type: 'presence', people: presencePeople(workspaceId) });
      for (const s of hub.sessionsOf(workspaceId)) {
        if (s !== session) hub.send(s, { type: 'notice', text: `${user.name} joined.` });
      }
    });
  });
});

async function handleSocketMessage(session: hub.Session, msg: Record<string, unknown>): Promise<void> {
  const type = msg.type;
  if (type === 'cursor') {
    session.pageId = typeof msg.pageId === 'string' ? msg.pageId : session.pageId;
    const x = typeof msg.x === 'number' ? msg.x : 0;
    const y = typeof msg.y === 'number' ? msg.y : 0;
    session.cursor = { x, y };
    for (const s of hub.sessionsOf(session.workspaceId)) {
      if (s.userId !== session.userId && s.pageId === session.pageId) {
        hub.send(s, { type: 'cursor', userId: session.userId, name: session.name, pageId: session.pageId, x, y });
      }
    }
    return;
  }
  if (type === 'select') {
    const nodeId = msg.nodeId as string | null;
    for (const s of hub.sessionsOf(session.workspaceId)) {
      if (s.userId !== session.userId) hub.send(s, { type: 'selection', userId: session.userId, nodeId });
    }
    return;
  }
  if (type === 'op') {
    const op = msg.op as Record<string, unknown>;
    try {
      const outcome = await handleOperation({
        workspaceId: session.workspaceId, userId: session.userId, userName: session.name,
        op: op as never,
      });
      hub.send(session, { type: 'ack', opId: op.opId, seq: outcome.seq, created: outcome.created });
      if (outcome.conflictFor) {
        for (const s of hub.sessionsOf(session.workspaceId)) {
          if (s.userId === outcome.conflictFor!.userId) {
            hub.send(s, {
              type: 'conflict', opId: op.opId as string, property: outcome.conflictFor!.property,
              value: outcome.conflictFor!.value, winner: { id: session.userId, name: session.name },
            });
          }
        }
      }
      hub.broadcastWorkspace(session.workspaceId, {
        type: 'op', seq: outcome.seq, author: { id: session.userId, name: session.name },
        op: { ...op, ...(outcome.created ?? {}) },
      }, session.userId);
    } catch (err) {
      if (err instanceof HttpError) {
        hub.send(session, { type: 'reject', opId: op.opId, error: { code: err.err.code, message: errorMessageOf(err), fields: 'fields' in err.err ? err.err.fields : undefined } });
      } else {
        hub.send(session, { type: 'reject', opId: op.opId, error: { code: 'internal', message: 'Something went wrong.' } });
      }
    }
    return;
  }
  if (type === 'page') {
    session.pageId = typeof msg.pageId === 'string' ? msg.pageId : null;
    return;
  }
}

function errorMessageOf(err: HttpError): string {
  const body = JSON.parse(errorBody(err.err)) as { error: { message: string } };
  return body.error.message;
}

// ---------------------------------------------------------------------------
// multipart upload route handled specially

async function handleMultipartUpload(r: Req): Promise<void> {
  const body = r.body as { __multipart: Buffer; __boundary: string };
  const parts = r.url.pathname.split('/').filter(Boolean);
  const workspaceId = parts[2];
  await requireEditor(r, workspaceId);
  const file = extractFilePart(body.__multipart, body.__boundary);
  if (!file) throw invalid({ file: 'A file part is required.' });
  const result = await uploadImage(workspaceId, file.fileName, file.bytes);
  json.call(r, 201, result);
}

function extractFilePart(raw: Buffer, boundary: string): { fileName: string; bytes: Buffer } | null {
  const delim = Buffer.from(`--${boundary}`);
  let idx = raw.indexOf(delim);
  while (idx !== -1) {
    const start = idx + delim.length;
    const next = raw.indexOf(delim, start);
    if (next === -1) break;
    let part = raw.subarray(start, next);
    if (part[0] === 0x0d && part[1] === 0x0a) part = part.subarray(2);
    if (part[part.length - 2] === 0x0d && part[part.length - 1] === 0x0a) part = part.subarray(0, part.length - 2);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headers = part.subarray(0, headerEnd).toString('utf8');
      const m = /filename="([^"]*)"/i.exec(headers);
      if (m) {
        return { fileName: m[1], bytes: part.subarray(headerEnd + 4) };
      }
    }
    idx = next;
  }
  return null;
}

// ---------------------------------------------------------------------------
// boot

async function main(): Promise<void> {
  await waitForDatabase();
  hub.startPresencePinger((s) => {
    if (!s.closed) {
      s.closed = true;
      try { s.ws.close(1000, 'timeout'); } catch { /* already closed */ }
      hub.removeSession(s);
      hub.broadcastWorkspace(s.workspaceId, { type: 'presence', people: presencePeople(s.workspaceId) });
    }
  });
  server.listen(config.publicPort, '0.0.0.0', () => {
    console.log(`Plinth listening on port ${config.publicPort}`);
  });
}

void main();

