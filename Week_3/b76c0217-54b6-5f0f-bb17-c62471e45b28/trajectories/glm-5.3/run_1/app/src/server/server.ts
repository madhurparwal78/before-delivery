import * as express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Request, Response, NextFunction } from 'express';

import { config } from '../config';
import { ApiError, notFoundError, sendError, unauthenticatedError, badPathField } from '../errors';
import { MAX_JSON_BYTES, MAX_IMAGE_BYTES, MAX_OPENAPI_BYTES, MAX_PAGE_SOURCE_BYTES, isValidPath, isValidSlug, normalizePath, withLeadingSlash } from '../shared/rules';
import { copy } from '../shared/copy';
import { pool, applySchema } from './db';
import { getPage, getSite, getSiteBySlug, getVersion, getSiteVersions, getVersionBySlug, navigationJson } from './queries';
import type { PageRow } from './queries';
import * as auth from './auth';
import * as invites from './invites';
import * as redirectEngine from './redirects';
import * as publishEngine from './publish';
import * as openapiEngine from './openapi';
import * as searchEngine from './search';
import { renamePage, pageJson } from './rename';
import { storage, setStorageOutage, ensureBucket } from './storage';
import { setMailOutage, mailOut } from './mail';
import { events, subscribe, unsubscribe } from './events';
import { newId, newToken } from './ids';
import { renderPageHtml, esc } from './render';
import { renderScreen } from './screen';
import { editorShell, signinShell, appShell, teamShell, analyticsShell, redirectsShell, inviteShell, forbiddenShell } from './shells';

const app = express();

const serverRoot = process.cwd();
const SESSION_COOKIE = 'galley_session';
const READER_COOKIE = 'galley_reader';

function sendJson(res: Response, status: number, body: unknown): void {
  res.status(status).type('application/json').send(JSON.stringify(body));
}

function jsonBody(limit: number, handler: (req: Request, res: Response, body: unknown) => void) {
  return (req: Request, res: Response, next: NextFunction) => {
    const contentType = req.header('content-type') ?? '';
    if (!contentType.startsWith('application/json')) {
      sendError(res, new ApiError('unsupported_media_type', 'Unsupported media type.'));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        if (!done) { done = true; sendError(res, new ApiError('too_large', 'Body too large.')); }
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      const buf = Buffer.concat(chunks);
      let parsed: unknown;
      try {
        parsed = JSON.parse(buf.toString('utf8'));
      } catch {
        parsed = undefined;
      }
      handler(req, res, parsed);
    });
    req.on('error', () => { if (!done) { done = true; next(new Error('read error')); } });
  };
}

function rawBody(limit: number, types: string[], handler: (req: Request, res: Response, buf: Buffer) => void) {
  return (req: Request, res: Response, next: NextFunction) => {
    const contentType = (req.header('content-type') ?? '').split(';')[0];
    if (!types.includes(contentType)) {
      sendError(res, new ApiError('unsupported_media_type', 'Unsupported media type.'));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        if (!done) { done = true; sendError(res, new ApiError('too_large', 'Body too large.')); }
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      handler(req, res, Buffer.concat(chunks));
    });
    req.on('error', () => { if (!done) { done = true; next(new Error('read error')); } });
  };
}

function cookieOf(req: Request, name: string): string | undefined {
  const raw = req.header('cookie') ?? '';
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return undefined;
}

app.use((req, res, next) => {
  const origin = req.header('origin');
  if (origin && req.method !== 'GET' && req.method !== 'HEAD') {
    let same = false;
    try {
      const u = new URL(origin);
      same = u.host === (req.header('host') ?? '');
    } catch {
      same = false;
    }
    if (!same) {
      sendError(res, new ApiError('cross_origin', 'Cross-origin request refused.'));
      return;
    }
  }
  next();
});

type Ctx = { user: auth.SessionUser | null };
declare global {
  namespace Express {
    interface Request { ctx?: Ctx }
  }
}

function requireUser(req: Request, res: Response, next: NextFunction): void {
  void auth.getSessionUser(cookieOf(req, SESSION_COOKIE)).then((user) => {
    if (!user) { sendError(res, unauthenticatedError()); return; }
    req.ctx = { user };
    next();
  });
}

function requireRole(min: 'viewer' | 'editor' | 'owner') {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.ctx?.user;
    if (!user) { sendError(res, unauthenticatedError()); return; }
    if (!auth.isRole(user.role, min)) { sendError(res, new ApiError('forbidden_role', copy.noAccess)); return; }
    next();
  };
}

function pageOrThrow(res: Response, page: PageRow | null): PageRow {
  if (!page || page.state === 'removed') { sendError(res, notFoundError()); throw SENT; }
  return page;
}

class SentError extends Error {}
const SENT = new SentError('response already sent');

function isSent(err: unknown): boolean {
  return err === SENT;
}

function userName(userId: string | null): Promise<string> {
  if (!userId) return Promise.resolve('');
  return pool.query<{ name: string }>('SELECT name FROM users WHERE id = $1', [userId]).then((r) => r.rows[0]?.name ?? '');
}

async function versionInTeam(versionId: string, teamId: string): Promise<boolean> {
  const version = await getVersion(versionId);
  if (!version) return false;
  const site = await getSite(version.site_id);
  return site?.team_id === teamId;
}

// ---------- Health ----------
app.get('/api/health', (_req, res) => { sendJson(res, 200, { status: 'ok' }); });
app.head('/api/health', (_req, res) => { res.status(200).end(); });

// ---------- Session ----------
app.post('/api/session', jsonBody(MAX_JSON_BYTES, async (req, res, body) => {
  const b = body as { email?: string; password?: string; next?: string };
  const email = (b?.email ?? '').trim().toLowerCase();
  const password = b?.password ?? '';
  const r = await pool.query<{ id: string; password_hash: string; name: string }>(
    'SELECT id, password_hash, name FROM users WHERE email = $1', [email],
  );
  const row = r.rows[0];
  if (!row || !auth.verifyPassword(password, row.password_hash)) {
    sendError(res, new ApiError('invalid_credentials', copy.signInFailed));
    return;
  }
  const token = await auth.createSession(row.id);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`);
  sendJson(res, 200, { user: { id: row.id, email, name: row.name }, redirectTo: safeNext(b?.next) });
}));

function safeNext(next: string | undefined): string {
  if (!next || typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.includes('\\') || next.includes('://')) {
    return '/app';
  }
  return next;
}

app.delete('/api/session', (req, res) => {
  void auth.destroySession(cookieOf(req, SESSION_COOKIE) ?? undefined);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.status(204).end();
});

app.get('/api/me', requireUser, (req, res) => {
  const user = req.ctx!.user!;
  void pool.query<{ id: string; name: string }>('SELECT id, name FROM teams WHERE id = $1', [user.teamId]).then((team) => {
    sendJson(res, 200, { user: { id: user.id, email: user.email, name: user.name }, team: team.rows[0], role: user.role });
  });
});

// ---------- Team ----------
app.get('/api/team', requireUser, requireRole('owner'), async (req, res) => {
  const user = req.ctx!.user!;
  const members = await pool.query<{ id: string; name: string; email: string; role: string }>(
    'SELECT id, name, email, role FROM users WHERE team_id = $1 ORDER BY created_at', [user.teamId],
  );
  await invites.expireInvites();
  const refreshed = await pool.query<invites.InviteRow>('SELECT * FROM invites WHERE team_id = $1 ORDER BY created_at', [user.teamId]);
  sendJson(res, 200, {
    id: user.teamId,
    name: user.teamName,
    members: members.rows.map((m) => ({ userId: m.id, name: m.name, email: m.email, role: m.role })),
    invites: refreshed.rows.map(invites.inviteJson),
  });
});

app.post('/api/team/invites', requireUser, requireRole('owner'), jsonBody(MAX_JSON_BYTES, async (req, res, body) => {
  const user = req.ctx!.user!;
  const b = body as { email?: string; role?: string };
  const email = (b?.email ?? '').trim().toLowerCase();
  const role = b?.role;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    sendError(res, new ApiError('validation_failed', 'Validation failed.', { fields: { email: 'Enter an email address.' } }));
    return;
  }
  if (role !== 'editor' && role !== 'viewer') {
    sendError(res, new ApiError('validation_failed', 'Validation failed.', { fields: { role: 'Choose a role.' } }));
    return;
  }
  const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existingUser.rows.length > 0) { sendError(res, new ApiError('email_in_use', 'That email already has an account.')); return; }
  const pending = await pool.query(
    "SELECT id FROM invites WHERE email = $1 AND status IN ('held','sent') AND created_at > now() - ($2 || ' milliseconds')::interval",
    [email, String(config.inviteTtlMs)],
  );
  if (pending.rows.length > 0) { sendError(res, new ApiError('invite_pending', 'An invite for that email is already pending.')); return; }
  const { invite, held } = await invites.createInvite(user.teamId, user.name, email, role);
  sendJson(res, held ? 202 : 201, invites.inviteJson(invite));
}));

app.post('/api/team/invites/:inviteId/send', requireUser, requireRole('owner'), async (req, res) => {
  const user = req.ctx!.user!;
  const r = await pool.query<invites.InviteRow>(
    "SELECT * FROM invites WHERE id = $1 AND team_id = $2 AND status = 'held'", [req.params.inviteId, user.teamId],
  );
  const invite = r.rows[0];
  if (!invite) { sendError(res, notFoundError()); return; }
  if (mailOut()) { sendError(res, new ApiError('mail_unavailable', copy.stillUnavailable)); return; }
  const sent = await invites.trySend(invite, user.name);
  sendJson(res, 200, invites.inviteJson(sent));
});

app.put('/api/team/members/:userId', requireUser, requireRole('owner'), jsonBody(MAX_JSON_BYTES, async (req, res, body) => {
  const user = req.ctx!.user!;
  const b = body as { role?: string };
  const role = b?.role;
  if (role !== 'editor' && role !== 'viewer') {
    sendError(res, new ApiError('validation_failed', 'Validation failed.', { fields: { role: 'Choose a role.' } }));
    return;
  }
  const target = await pool.query<{ id: string; name: string; email: string; role: string }>(
    'SELECT id, name, email, role FROM users WHERE id = $1 AND team_id = $2', [req.params.userId, user.teamId],
  );
  const member = target.rows[0];
  if (!member) { sendError(res, notFoundError()); return; }
  if (member.role === 'owner') { sendError(res, new ApiError('owner_role_fixed', "The owner's role cannot change.")); return; }
  await pool.query('UPDATE users SET role = $2 WHERE id = $1', [member.id, role]);
  events.role(user.teamId, member.id, role);
  sendJson(res, 200, { userId: member.id, name: member.name, email: member.email, role });
}));

app.post('/api/invites/:token/accept', jsonBody(MAX_JSON_BYTES, async (req, res, body) => {
  const b = body as { name?: string; password?: string };
  const name = (b?.name ?? '').trim();
  const password = b?.password ?? '';
  if (!name) { sendError(res, new ApiError('validation_failed', 'Validation failed.', { fields: { name: 'Enter your name.' } })); return; }
  if (password.length < 10 || password.length > 200) {
    sendError(res, new ApiError('validation_failed', 'Validation failed.', { fields: { password: 'Password must be 10 to 200 characters.' } }));
    return;
  }
  await invites.expireInvites();
  const r = await pool.query<invites.InviteRow>(
    "SELECT * FROM invites WHERE token = $1 AND status = 'sent'", [req.params.token],
  );
  const invite = r.rows[0];
  if (!invite) { sendError(res, new ApiError('invite_invalid', copy.inviteInvalid, { status: 410 })); return; }
  const taken = await pool.query('SELECT id FROM users WHERE email = $1', [invite.email]);
  if (taken.rows.length > 0) { sendError(res, new ApiError('invite_invalid', copy.inviteInvalid)); return; }
  const userId = newId('usr');
  await pool.query(
    'INSERT INTO users (id, team_id, email, name, password_hash, role) VALUES ($1, $2, $3, $4, $5, $6)',
    [userId, invite.team_id, invite.email, name, await auth.hashPassword(password), invite.role],
  );
  await pool.query("UPDATE invites SET status = 'accepted', accepted_at = now() WHERE id = $1", [invite.id]);
  const token = await auth.createSession(userId);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`);
  const user = await auth.getSessionUser(token);
  sendJson(res, 201, { user: { id: user!.id, email: user!.email, name: user!.name } });
}));
// ---------- Pages ----------
app.get('/api/pages/:pageId', requireUser, async (req, res) => {
  const user = req.ctx!.user!;
  const page = pageOrThrow(res, await getPage(req.params.pageId));
  if (!await versionInTeam(page.version_id, user.teamId)) { sendError(res, notFoundError()); return; }
  sendJson(res, 200, pageJson(page, await userName(page.updated_by)));
});

app.post('/api/versions/:versionId/pages', requireUser, requireRole('editor'), jsonBody(MAX_JSON_BYTES, async (req, res, body) => {
  const user = req.ctx!.user!;
  if (!await versionInTeam(req.params.versionId, user.teamId)) { sendError(res, notFoundError()); return; }
  const b = body as { title?: string; path?: string; groupId?: string };
  const title = (b?.title ?? '').trim();
  const path = normalizePath(b?.path ?? '');
  if (!title) { sendError(res, new ApiError('validation_failed', 'Validation failed.', { fields: { title: 'Enter a title.' } })); return; }
  if (!isValidPath(path)) { sendError(res, badPathField('path')); return; }
  if (b?.groupId) {
    const group = await pool.query<{ version_id: string }>(
      'SELECT t.version_id FROM groups g JOIN tabs t ON t.id = g.tab_id WHERE g.id = $1', [b.groupId],
    );
    if (!group.rows[0] || group.rows[0].version_id !== req.params.versionId) { sendError(res, notFoundError()); return; }
  }
  const clash = await pool.query(
    "SELECT id FROM pages WHERE version_id = $1 AND path = $2 AND state != 'removed'", [req.params.versionId, path],
  );
  if (clash.rows.length > 0) { sendError(res, new ApiError('path_taken', copy.pathTaken(withLeadingSlash(path)))); return; }
  const pos = await pool.query<{ n: number }>(
    "SELECT coalesce(max(position), -1) + 1 AS n FROM pages WHERE version_id = $1 AND group_id = $2", [req.params.versionId, b?.groupId ?? null],
  );
  const id = newId('pg');
  await pool.query(
    `INSERT INTO pages (id, version_id, group_id, position, path, title, kind, source, revision, state, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'page', $7, 0, 'draft', $8)`,
    [id, req.params.versionId, b?.groupId ?? null, pos.rows[0]?.n ?? 0, path, title, `# ${title}\n\n`, user.id],
  );
  const page = (await getPage(id))!;
  events.navigation(req.params.versionId, await navigationJson(req.params.versionId));
  sendJson(res, 201, pageJson(page, user.name));
}));

app.put('/api/pages/:pageId', requireUser, requireRole('editor'), jsonBody(MAX_JSON_BYTES, async (req, res, body) => {
  const user = req.ctx!.user!;
  const page = pageOrThrow(res, await getPage(req.params.pageId));
  if (!await versionInTeam(page.version_id, user.teamId)) { sendError(res, notFoundError()); return; }
  const b = body as { title?: string; source?: string; revision?: number };
  if (b?.source !== undefined && Buffer.byteLength(b.source, 'utf8') > MAX_PAGE_SOURCE_BYTES) {
    sendError(res, new ApiError('too_large', 'Page source too large.'));
    return;
  }
  if (typeof b?.revision !== 'number') {
    sendError(res, new ApiError('validation_failed', 'Validation failed.', { fields: { revision: 'Send the revision.' } }));
    return;
  }
  if (page.revision !== b.revision) {
    const savedBy = await userName(page.updated_by);
    sendError(res, new ApiError('revision_conflict', copy.conflict(savedBy || 'Another editor'), {
      savedBy: { id: page.updated_by ?? '', name: savedBy },
    }));
    return;
  }
  if (page.kind === 'reference' && b?.source !== undefined && b.source !== page.source) {
    sendError(res, new ApiError('reference_page', 'Reference pages are generated from the OpenAPI file.'));
    return;
  }
  const title = b?.title !== undefined ? b.title.trim() : page.title;
  if (!title) { sendError(res, new ApiError('validation_failed', 'Validation failed.', { fields: { title: 'Enter a title.' } })); return; }
  const source = b?.source ?? page.source;
  const newState: string = page.state === 'published' ? 'published'
    : (page.state === 'in_preview' && await hasActivePreview(page.id)) ? 'in_preview' : 'draft';
  const updated = await pool.query<PageRow>(
    `UPDATE pages SET title = $2, source = $3, revision = $4, state = $5,
     has_draft_changes = true, updated_at = now(), updated_by = $6 WHERE id = $1 RETURNING *`,
    [page.id, title, source, page.revision + 1, newState, user.id],
  );
  const row = updated.rows[0];
  events.page(page.id, page.version_id, pageJson(row, user.name));
  sendJson(res, 200, pageJson(row, user.name));
}));

async function hasActivePreview(pageId: string): Promise<boolean> {
  const r = await pool.query('SELECT id FROM preview_links WHERE page_id = $1 AND revoked = false AND expires_at > now()', [pageId]);
  return r.rows.length > 0;
}

app.post('/api/pages/:pageId/rename', requireUser, requireRole('editor'), jsonBody(MAX_JSON_BYTES, async (req, res, body) => {
  const user = req.ctx!.user!;
  const page = pageOrThrow(res, await getPage(req.params.pageId));
  if (!await versionInTeam(page.version_id, user.teamId)) { sendError(res, notFoundError()); return; }
  const b = body as { path?: string; revision?: number };
  const path = normalizePath(b?.path ?? '');
  if (!isValidPath(path)) { sendError(res, badPathField('path')); return; }
  if (typeof b?.revision !== 'number') {
    sendError(res, new ApiError('validation_failed', 'Validation failed.', { fields: { revision: 'Send the revision.' } }));
    return;
  }
  try {
    const result = await renamePage(page, path, b.revision, user.id, user.name);
    sendJson(res, 200, result);
  } catch (err) {
    sendError(res, err);
  }
}));

app.delete('/api/pages/:pageId', requireUser, requireRole('editor'), (req, res, next) => {
  void (async () => {
    const user = req.ctx!.user!;
    const page = pageOrThrow(res, await getPage(req.params.pageId));
    if (!await versionInTeam(page.version_id, user.teamId)) { sendError(res, notFoundError()); return; }
    const updated = await pool.query<PageRow>(
      "UPDATE pages SET state = 'removed', updated_at = now(), updated_by = $2 WHERE id = $1 RETURNING *", [page.id, user.id],
    );
    events.navigation(page.version_id, await navigationJson(page.version_id));
    sendJson(res, 200, pageJson(updated.rows[0], user.name));
  })().catch(next);
});

// ---------- Navigation ----------
app.get('/api/versions/:versionId/navigation', requireUser, async (req, res) => {
  const user = req.ctx!.user!;
  if (!await versionInTeam(req.params.versionId, user.teamId)) { sendError(res, notFoundError()); return; }
  sendJson(res, 200, await navigationJson(req.params.versionId));
});

app.post('/api/versions/:versionId/tabs', requireUser, requireRole('editor'), jsonBody(MAX_JSON_BYTES, async (req, res, body) => {
  if (!await versionInTeam(req.params.versionId, req.ctx!.user!.teamId)) { sendError(res, notFoundError()); return; }
  const b = body as { title?: string };
  const title = (b?.title ?? '').trim();
  if (!title) { sendError(res, new ApiError('validation_failed', 'Validation failed.', { fields: { title: 'Enter a title.' } })); return; }
  const pos = await pool.query<{ n: number }>('SELECT coalesce(max(position), -1) + 1 AS n FROM tabs WHERE version_id = $1', [req.params.versionId]);
  const id = newId('tab');
  await pool.query('INSERT INTO tabs (id, version_id, title, position) VALUES ($1, $2, $3, $4)', [id, req.params.versionId, title, pos.rows[0].n]);
  const nav = await navigationJson(req.params.versionId);
  events.navigation(req.params.versionId, nav);
  sendJson(res, 201, nav);
}));

app.post('/api/versions/:versionId/groups', requireUser, requireRole('editor'), jsonBody(MAX_JSON_BYTES, async (req, res, body) => {
  if (!await versionInTeam(req.params.versionId, req.ctx!.user!.teamId)) { sendError(res, notFoundError()); return; }
  const b = body as { tabId?: string; title?: string };
  const title = (b?.title ?? '').trim();
  if (!title) { sendError(res, new ApiError('validation_failed', ' Validation failed.', { fields: { title: 'Enter a title.' } })); return; }
  const tab = await pool.query<{ version_id: string }>('SELECT version_id FROM tabs WHERE id = $1', [b?.tabId ?? '']);
  if (!tab.rows[0] || tab.rows[0].version_id !== req.params.versionId) { sendError(res, notFoundError()); return; }
  const pos = await pool.query<{ n: number }>('SELECT coalesce(max(position), -1) + 1 AS n FROM groups WHERE tab_id = $1', [b!.tabId]);
  const id = newId('grp');
  await pool.query('INSERT INTO groups (id, tab_id, title, position) VALUES ($1, $2, $3, $4)', [id, b!.tabId, title, pos.rows[0].n]);
  const nav = await navigationJson(req.params.versionId);
  events.navigation(req.params.versionId, nav);
  sendJson(res, 201, nav);
}));

app.post('/api/pages/:pageId/move', requireUser, requireRole('editor'), jsonBody(MAX_JSON_BYTES, async (req, res, body) => {
  const user = req.ctx!.user!;
  const page = pageOrThrow(res, await getPage(req.params.pageId));
  if (!await versionInTeam(page.version_id, user.teamId)) { sendError(res, notFoundError()); return; }
  const b = body as { groupId?: string; index?: number };
  if (b?.groupId) {
    const group = await pool.query<{ version_id: string }>(
      'SELECT t.version_id FROM groups g JOIN tabs t ON t.id = g.tab_id WHERE g.id = $1', [b.groupId],
    );
    if (!group.rows[0] || group.rows[0].version_id !== page.version_id) { sendError(res, notFoundError()); return; }
  }
  await movePage(page, b?.groupId ?? null, b?.index ?? 0);
  const nav = await navigationJson(page.version_id);
  events.navigation(page.version_id, nav);
  sendJson(res, 200, nav);
}));

async function movePage(page: PageRow, groupId: string | null, index: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const others = await client.query<{ id: string }>(
      "SELECT id FROM pages WHERE version_id = $1 AND state != 'removed' AND group_id = $2 AND id != $3 ORDER BY position",
      [page.version_id, groupId, page.id],
    );
    const clamped = Math.max(0, Math.min(index, others.rows.length));
    let pos = 0;
    for (const other of others.rows) {
      if (pos === clamped) pos++;
      await client.query('UPDATE pages SET position = $2 WHERE id = $1', [other.id, pos++]);
    }
    await client.query('UPDATE pages SET group_id = $2, position = $3 WHERE id = $1', [page.id, groupId, clamped]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

app.post('/api/groups/:groupId/move', requireUser, requireRole('editor'), jsonBody(MAX_JSON_BYTES, async (req, res, body) => {
  const user = req.ctx!.user!;
  const versionRow = await pool.query<{ version_id: string; team_id: string }>(
    'SELECT t.version_id, s.team_id FROM groups g JOIN tabs t ON t.id = g.tab_id JOIN versions v ON v.id = t.version_id JOIN sites s ON s.id = v.site_id WHERE g.id = $1',
    [req.params.groupId],
  );
  if (!versionRow.rows[0] || versionRow.rows[0].team_id !== user.teamId) { sendError(res, notFoundError()); return; }
  const versionId = versionRow.rows[0].version_id;
  const b = body as { tabId?: string; index?: number };
  if (b?.tabId) {
    const tab = await pool.query<{ version_id: string }>('SELECT version_id FROM tabs WHERE id = $1', [b.tabId]);
    if (!tab.rows[0] || tab.rows[0].version_id !== versionId) { sendError(res, notFoundError()); return; }
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE groups SET tab_id = $2 WHERE id = $1', [req.params.groupId, b?.tabId ?? null]);
    const others = await client.query<{ id: string }>(
      'SELECT id FROM groups WHERE tab_id = $1 AND id != $2 ORDER BY position', [b?.tabId ?? null, req.params.groupId],
    );
    const clamped = Math.max(0, Math.min(b?.index ?? 0, others.rows.length));
    let pos = 0;
    for (const other of others.rows) {
      if (pos === clamped) pos++;
      await client.query('UPDATE groups SET position = $2 WHERE id = $1', [other.id, pos++]);
    }
    await client.query('UPDATE groups SET position = $2 WHERE id = $1', [req.params.groupId, clamped]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  const nav = await navigationJson(versionId);
  events.navigation(versionId, nav);
  sendJson(res, 200, nav);
}));

// ---------- Redirects ----------
app.post('/api/versions/:versionId/redirects', requireUser, requireRole('editor'), jsonBody(MAX_JSON_BYTES, async (req, res, body) => {
  const user = req.ctx!.user!;
  if (!await versionInTeam(req.params.versionId, user.teamId)) { sendError(res, notFoundError()); return; }
  const b = body as { from?: string; to?: string };
  const from = b?.from ?? '';
  const to = b?.to ?? '';
  if (!isValidPath(normalizePath(from))) { sendError(res, badPathField('from')); return; }
  if (!redirectEngine.isOnSitePath(to)) {
    sendError(res, new ApiError('redirect_off_site', copy.offSite, { fields: { to: copy.offSite } }));
    return;
  }
  if (!isValidPath(normalizePath(to))) { sendError(res, badPathField('to')); return; }
  try {
    const nav = await redirectEngine.addManualRedirect(req.params.versionId, from, to);
    events.navigation(req.params.versionId, nav);
    sendJson(res, 201, nav);
  } catch (err) {
    sendError(res, err);
  }
}));

app.delete('/api/versions/:versionId/redirects', requireUser, requireRole('editor'), async (req, res) => {
  const user = req.ctx!.user!;
  if (!await versionInTeam(req.params.versionId, user.teamId)) { sendError(res, notFoundError()); return; }
  const nav = await redirectEngine.removeRedirect(req.params.versionId, String(req.query.from ?? ''));
  events.navigation(req.params.versionId, nav);
  sendJson(res, 200, nav);
});


// ---------- Assets ----------
app.post('/api/sites/:siteId/assets', requireUser, requireRole('editor'), rawBody(MAX_IMAGE_BYTES, ['image/png', 'image/jpeg', 'image/webp'], async (req, res, buf) => {
  const user = req.ctx!.user!;
  const site = await getSite(req.params.siteId);
  if (!site || site.team_id !== user.teamId) { sendError(res, notFoundError()); return; }
  const contentType = (req.header('content-type') ?? '').split(';')[0];
  const id = newId('img');
  try {
    await storage.image(site.id, id, buf, contentType);
  } catch {
    sendError(res, new ApiError('storage_unavailable', copy.imageOutage));
    return;
  }
  await pool.query('INSERT INTO images (id, site_id, content_type, bytes) VALUES ($1, $2, $3, $4)', [id, site.id, contentType, buf.length]);
  sendJson(res, 201, { id, url: `/assets/${site.slug}/${id}` });
}));

app.get('/assets/:siteSlug/:imageId', async (req, res) => {
  const site = await getSiteBySlug(req.params.siteSlug);
  if (!site) { sendError(res, notFoundError()); return; }
  const row = await pool.query<{ content_type: string }>('SELECT content_type FROM images WHERE id = $1 AND site_id = $2', [req.params.imageId, site.id]);
  if (!row.rows[0]) { sendError(res, notFoundError()); return; }
  try {
    const stored = await storage.tryGet(`sites/${site.id}/assets/${req.params.imageId}`);
    if (!stored) { sendError(res, notFoundError()); return; }
    res.setHeader('Content-Type', row.rows[0].content_type);
    res.status(200).send(stored);
  } catch {
    sendError(res, new ApiError('storage_unavailable', 'File storage is unavailable.'));
  }
});

// ---------- Publishing ----------
app.post('/api/versions/:versionId/check', requireUser, requireRole('editor'), async (req, res) => {
  const user = req.ctx!.user!;
  if (!await versionInTeam(req.params.versionId, user.teamId)) { sendError(res, notFoundError()); return; }
  const check = await publishEngine.runCheck(req.params.versionId);
  sendJson(res, 200, { pages: check.pages, changedPages: check.changedPages, errors: check.errors });
});

app.post('/api/versions/:versionId/publish', requireUser, requireRole('editor'), (req, res, next) => {
  void (async () => {
    const user = req.ctx!.user!;
    if (!await versionInTeam(req.params.versionId, user.teamId)) { sendError(res, notFoundError()); return; }
    const key = req.header('idempotency-key') ?? '';
    if (key.length < 1 || key.length > 100) {
      sendError(res, new ApiError('idempotency_key_required', 'Send an Idempotency-Key header.'));
      return;
    }
    const report = await publishEngine.publishVersion(req.params.versionId, key);
    sendJson(res, 200, report);
  })().catch((err) => { sendError(res, err); void next; });
});

app.get('/api/versions/:versionId/publish-report', requireUser, async (req, res) => {
  const user = req.ctx!.user!;
  if (!await versionInTeam(req.params.versionId, user.teamId)) { sendError(res, notFoundError()); return; }
  const attempt = await publishEngine.currentAttempt(req.params.versionId);
  if (!attempt) {
    sendJson(res, 200, { versionId: req.params.versionId, status: 'idle', publishedAt: null, snapshotId: null, errors: [] });
    return;
  }
  sendJson(res, 200, attempt.report);
});

// ---------- Sites and versions ----------
app.get('/api/sites/:siteId', requireUser, async (req, res) => {
  const user = req.ctx!.user!;
  const site = await getSite(req.params.siteId);
  if (!site || site.team_id !== user.teamId) { sendError(res, notFoundError()); return; }
  sendJson(res, 200, { id: site.id, slug: site.slug, title: site.title, versions: await siteVersionsJson(site.id) });
});

export async function siteVersionsJson(siteId: string): Promise<{ id: string; slug: string; title: string; default: boolean; publishedAt: string | null }[]> {
  const versions = await getSiteVersions(siteId);
  const out: { id: string; slug: string; title: string; default: boolean; publishedAt: string | null }[] = [];
  for (const v of versions) {
    const attempt = await pool.query<{ published_at: Date | null }>(
      "SELECT published_at FROM publish_attempts WHERE version_id = $1 AND status = 'published' ORDER BY published_at DESC LIMIT 1", [v.id],
    );
    out.push({
      id: v.id, slug: v.slug, title: v.title,
      default: await isDefaultVersion(siteId, v.id),
      publishedAt: attempt.rows[0]?.published_at ? new Date(attempt.rows[0].published_at).toISOString() : null,
    });
  }
  return out;
}

async function isDefaultVersion(siteId: string, versionId: string): Promise<boolean> {
  const r = await pool.query('SELECT default_version_id FROM sites WHERE id = $1', [siteId]);
  return r.rows[0]?.default_version_id === versionId;
}

app.post('/api/sites/:siteId/versions', requireUser, requireRole('editor'), jsonBody(MAX_JSON_BYTES, async (req, res, body) => {
  const user = req.ctx!.user!;
  const site = await getSite(req.params.siteId);
  if (!site || site.team_id !== user.teamId) { sendError(res, notFoundError()); return; }
  const b = body as { fromVersionId?: string; slug?: string; title?: string };
  const slug = b?.slug ?? '';
  const title = (b?.title ?? '').trim();
  if (!isValidSlug(slug)) { sendError(res, badPathField('slug')); return; }
  if (!title) { sendError(res, new ApiError('validation_failed', 'Validation failed.', { fields: { title: 'Enter a title.' } })); return; }
  const from = b?.fromVersionId ? await getVersion(b.fromVersionId) : null;
  if (!from || from.site_id !== site.id) { sendError(res, notFoundError()); return; }
  const clash = await getVersionBySlug(site.id, slug);
  if (clash) { sendError(res, new ApiError('slug_taken', `Another version already uses ${slug}.`)); return; }
  const newVersionId = await createVersionCopy(site.id, from.id, slug, title);
  sendJson(res, 201, { id: newVersionId, slug, title, default: false, publishedAt: null });
}));

async function createVersionCopy(siteId: string, fromVersionId: string, slug: string, title: string): Promise<string> {
  const client = await pool.connect();
  const versionId = newId('ver');
  try {
    await client.query('BEGIN');
    const pos = await client.query<{ n: number }>('SELECT coalesce(max(position), -1) + 1 AS n FROM versions WHERE site_id = $1', [siteId]);
    await client.query('INSERT INTO versions (id, site_id, slug, title, position) VALUES ($1, $2, $3, $4, $5)', [versionId, siteId, slug, title, pos.rows[0].n]);
    const tabs = await client.query<{ id: string; title: string; position: number }>('SELECT id, title, position FROM tabs WHERE version_id = $1 ORDER BY position', [fromVersionId]);
    const tabMap = new Map<string, string>();
    for (const t of tabs.rows) {
      const id = newId('tab');
      await client.query('INSERT INTO tabs (id, version_id, title, position) VALUES ($1, $2, $3, $4)', [id, versionId, t.title, t.position]);
      tabMap.set(t.id, id);
    }
    const groups = await client.query<{ id: string; tab_id: string; title: string; position: number }>(
      'SELECT id, tab_id, title, position FROM groups WHERE tab_id = ANY($1) ORDER BY position', [tabs.rows.map((t) => t.id)],
    );
    const groupMap = new Map<string, string>();
    for (const g of groups.rows) {
      const id = newId('grp');
      await client.query('INSERT INTO groups (id, tab_id, title, position) VALUES ($1, $2, $3, $4)', [id, tabMap.get(g.tab_id)!, g.title, g.position]);
      groupMap.set(g.id, id);
    }
    const pages = await client.query<PageRow>("SELECT * FROM pages WHERE version_id = $1 AND state != 'removed' ORDER BY position", [fromVersionId]);
    for (const p of pages.rows) {
      const id = newId('pg');
      await client.query(
        `INSERT INTO pages (id, version_id, group_id, position, path, title, kind, operation_id, source, revision, state, has_draft_changes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, 'draft', true)`,
        [id, versionId, p.group_id ? groupMap.get(p.group_id) ?? null : null, p.position, p.path, p.title, p.kind, p.operation_id, p.source],
      );
    }
    const redirects = await client.query<{ from_path: string; to_path: string; kind: string }>('SELECT from_path, to_path, kind FROM redirects WHERE version_id = $1', [fromVersionId]);
    for (const r of redirects.rows) {
      await client.query('INSERT INTO redirects (id, version_id, from_path, to_path, kind) VALUES ($1, $2, $3, $4, $5)', [newId('red'), versionId, r.from_path, r.to_path, r.kind]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return versionId;
}

app.post('/api/versions/:versionId/make-default', requireUser, requireRole('owner'), async (req, res) => {
  const user = req.ctx!.user!;
  if (!await versionInTeam(req.params.versionId, user.teamId)) { sendError(res, notFoundError()); return; }
  const version = await getVersion(req.params.versionId);
  if (!version) { sendError(res, notFoundError()); return; }
  const published = await pool.query("SELECT id FROM publish_attempts WHERE version_id = $1 AND status = 'published'", [version.id]);
  if (published.rows.length === 0) { sendError(res, new ApiError('version_unpublished', 'Only a published version can become the default.')); return; }
  const site = await getSite(version.site_id);
  if (!site) { sendError(res, notFoundError()); return; }
  await pool.query('UPDATE sites SET default_version_id = $2 WHERE id = $1', [site.id, version.id]);
  sendJson(res, 200, { id: site.id, slug: site.slug, title: site.title, versions: await siteVersionsJson(site.id) });
});

// ---------- Preview links ----------
app.post('/api/pages/:pageId/preview-links', requireUser, requireRole('editor'), async (req, res) => {
  const user = req.ctx!.user!;
  const page = pageOrThrow(res, await getPage(req.params.pageId));
  if (!await versionInTeam(page.version_id, user.teamId)) { sendError(res, notFoundError()); return; }
  const id = newId('pl');
  const token = newToken(24);
  const expiresAt = new Date(Date.now() + config.previewLinkTtlMs);
  await pool.query('INSERT INTO preview_links (id, page_id, token, expires_at) VALUES ($1, $2, $3, $4)', [id, page.id, token, expiresAt]);
  if (page.state === 'draft') {
    await pool.query("UPDATE pages SET state = 'in_preview' WHERE id = $1", [page.id]);
  }
  sendJson(res, 201, { id, url: `/preview/${token}`, expiresAt: expiresAt.toISOString() });
});

app.get('/api/pages/:pageId/preview-links', requireUser, async (req, res) => {
  const user = req.ctx!.user!;
  const page = pageOrThrow(res, await getPage(req.params.pageId));
  if (!await versionInTeam(page.version_id, user.teamId)) { sendError(res, notFoundError()); return; }
  const r = await pool.query<{ id: string; token: string; expires_at: Date; revoked: boolean }>(
    'SELECT id, token, expires_at, revoked FROM preview_links WHERE page_id = $1 ORDER BY created_at DESC', [page.id],
  );
  sendJson(res, 200, r.rows.map((row) => ({
    id: row.id, url: `/preview/${row.token}`, expiresAt: new Date(row.expires_at).toISOString(), revoked: row.revoked,
  })));
});

app.delete('/api/preview-links/:linkId', requireUser, requireRole('editor'), async (req, res) => {
  const user = req.ctx!.user!;
  const link = await pool.query<{ id: string; page_id: string; version_id: string }>(
    'SELECT l.id, l.page_id, p.version_id FROM preview_links l JOIN pages p ON p.id = l.page_id WHERE l.id = $1', [req.params.linkId],
  );
  if (!link.rows[0] || !await versionInTeam(link.rows[0].version_id, user.teamId)) { sendError(res, notFoundError()); return; }
  await pool.query('UPDATE preview_links SET revoked = true WHERE id = $1', [link.rows[0].id]);
  const remaining = await pool.query('SELECT id FROM preview_links WHERE page_id = $1 AND revoked = false AND expires_at > now()', [link.rows[0].page_id]);
  if (remaining.rows.length === 0) {
    const page = await getPage(link.rows[0].page_id);
    if (page && page.state === 'in_preview') await pool.query("UPDATE pages SET state = 'draft' WHERE id = $1", [page.id]);
  }
  res.status(204).end();
});

// ---------- OpenAPI ----------
app.post('/api/versions/:versionId/openapi', requireUser, requireRole('editor'), rawBody(MAX_OPENAPI_BYTES, ['application/json'], async (req, res, buf) => {
  const user = req.ctx!.user!;
  if (!await versionInTeam(req.params.versionId, user.teamId)) { sendError(res, notFoundError()); return; }
  if (buf.length > MAX_OPENAPI_BYTES) { sendError(res, new ApiError('too_large', copy.importTooLarge)); return; }
  const fileName = String(req.query.name ?? 'openapi.json').slice(0, 200);
  try {
    const result = await openapiEngine.importOpenApi(req.params.versionId, fileName, buf);
    events.navigation(req.params.versionId, await navigationJson(req.params.versionId));
    sendJson(res, 201, result);
  } catch (err) {
    sendError(res, err);
  }
}));

app.get('/api/versions/:versionId/openapi/source', requireUser, async (req, res) => {
  const user = req.ctx!.user!;
  if (!await versionInTeam(req.params.versionId, user.teamId)) { sendError(res, notFoundError()); return; }
  const stored = await openapiEngine.storedOpenApi(req.params.versionId);
  if (!stored) { sendError(res, notFoundError()); return; }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${stored.fileName}"`);
  res.status(200).send(stored.bytes);
});

app.get('/api/versions/:versionId/openapi', requireUser, async (req, res) => {
  const user = req.ctx!.user!;
  if (!await versionInTeam(req.params.versionId, user.teamId)) { sendError(res, notFoundError()); return; }
  const info = await openapiEngine.openapiInfo(req.params.versionId);
  if (!info) { sendError(res, notFoundError()); return; }
  sendJson(res, 200, info);
});

// ---------- Mock ----------
app.post('/api/mock/:siteSlug/:versionSlug/:operationId', jsonBody(MAX_JSON_BYTES, async (req, res, body) => {
  const b = body as { code?: number | string; parameters?: Record<string, string>; body?: string };
  const op = await openapiEngine.operationFor(req.params.siteSlug, req.params.versionSlug, req.params.operationId);
  if (!op) { sendError(res, notNotFoundForOtherTeam()); return; }
  const code = String(b?.code ?? '');
  const response = op.responses.find((r) => r.code === code);
  if (!response) { sendError(res, new ApiError('mock_unknown_code', `The operation has no documented response ${code}.`)); return; }
  const fields: Record<string, string> = {};
  let firstMissing: string | null = null;
  for (const p of op.parameters) {
    const value = b?.parameters?.[p.name] ?? '';
    if (p.required && value === '') {
      fields[p.name] = copy.requiredParameter(p.name);
      if (!firstMissing) firstMissing = p.name;
    }
  }
  if (op.bodyExample !== null) {
    const text = b?.body ?? '';
    if (text.trim() === '') {
      if (op.bodyRequired) { fields.body = copy.invalidBody; if (!firstMissing) firstMissing = 'body'; }
    } else {
      try { JSON.parse(text); } catch { fields.body = copy.invalidBody; if (!firstMissing) firstMissing = 'body'; }
    }
  }
  if (Object.keys(fields).length > 0) {
    sendError(res, new ApiError('validation_failed', 'Validation failed.', { fields }));
    return;
  }
  sendJson(res, Number(code), response.example);
  void firstMissing;
}));

function notNotFoundForOtherTeam(): ApiError {
  return notFoundError();
}

// ---------- Analytics ----------
app.get('/api/sites/:siteId/analytics', requireUser, async (req, res) => {
  const user = req.ctx!.user!;
  const site = await getSite(req.params.siteId);
  if (!site || site.team_id !== user.teamId) { sendError(res, notFoundError()); return; }
  sendJson(res, 200, await (await import('./analytics')).analyticsForSite(site.id));
});

// ---------- Events (SSE) ----------
type PresenceEntry = { userId: string; name: string };
const presenceByPage = new Map<string, Map<string, PresenceEntry>>();

app.get('/api/events', requireUser, (req, res) => {
  const user = req.ctx!.user!;
  const versionId = (req.query.versionId as string | undefined) ?? null;
  const pageId = (req.query.pageId as string | undefined) ?? null;
  const client = subscribe(res, { teamId: user.teamId, userId: user.id, versionId, pageId, siteId: null });
  if (pageId) {
    let pagePresence = presenceByPage.get(pageId);
    if (!pagePresence) { pagePresence = new Map(); presenceByPage.set(pageId, pagePresence); }
    pagePresence.set(user.id, { userId: user.id, name: user.name });
    sendPresence(pageId);
  }
  req.on('close', () => {
    unsubscribe(client);
    if (pageId) {
      const pagePresence = presenceByPage.get(pageId);
      pagePresence?.delete(user.id);
      setTimeout(() => sendPresence(pageId), config.presenceTimeoutMs);
    }
  });
});

function sendPresence(pageId: string): void {
  const pagePresence = presenceByPage.get(pageId);
  const editors = [...(pagePresence?.values() ?? [])].map((e) => ({ id: e.userId, name: e.name }));
  events.presence(pageId, { pageId, editors });
}
type LiveSnapshotInfo = { snapshotId: string; manifest: publishEngine.ManifestJson; publishedAt: string };

async function liveSnapshot(versionId: string): Promise<LiveSnapshotInfo | null> {
  const r = await pool.query<{ id: string; manifest: publishEngine.ManifestJson; published_at: Date }>(
    'SELECT id, manifest, published_at FROM snapshots WHERE version_id = $1 ORDER BY published_at DESC LIMIT 1', [versionId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return { snapshotId: row.id, manifest: row.manifest, publishedAt: new Date(row.published_at).toISOString() };
}

app.get('/docs/:siteSlug', async (req, res) => {
  const site = await getSiteBySlug(req.params.siteSlug);
  if (!site) { res.status(404).send(readerNotFoundPage(null, null)); return; }
  const defaultRow = await pool.query<{ default_version_id: string | null }>('SELECT default_version_id FROM sites WHERE id = $1', [site.id]);
  const defaultId = defaultRow.rows[0]?.default_version_id;
  const version = defaultId ? await getVersion(defaultId) : null;
  const snapshot = version ? await liveSnapshot(version.id) : null;
  if (!version || !snapshot) { res.status(404).send(readerNotFoundPage(site, null)); return; }
  const firstPageId = snapshot.manifest.navigation.tabs.flatMap((t) => t.groups).flatMap((g) => g.pages)[0];
  const pagePath = snapshot.manifest.pages.find((p) => p.pageId === firstPageId)?.path;
  if (!pagePath) { res.status(404).send(readerNotFoundPage(site, version)); return; }
  res.redirect(302, `/docs/${site.slug}/${version.slug}/${pagePath}`);
});


app.get('/preview/:token(*)', async (req, res) => {
  const token = req.params.token;
  const r = await pool.query<{ id: string; page_id: string; revoked: boolean; expires_at: Date }>(
    'SELECT id, page_id, revoked, expires_at FROM preview_links WHERE token = $1', [token],
  );
  const link = r.rows[0];
  const expired = !link || link.revoked || link.expires_at.getTime() <= Date.now();
  if (expired) { res.status(410).send(expiredPreviewPage()); return; }
  const page = await getPage(link.page_id);
  if (!page || page.state === 'removed') { res.status(410).send(expiredPreviewPage()); return; }
  const version = await getVersion(page.version_id);
  const site = version ? await getSite(version.site_id) : null;
  if (!version || !site) { res.status(410).send(expiredPreviewPage()); return; }
  const nav = await navigationJson(version.id);
  const html = await renderScreen({ page, site, version, navigation: nav, mode: 'shared' });
  res.status(200).type('html').send(html);
});

app.all('/preview/:token(*)', (req, res) => { res.setHeader('Allow', 'GET, HEAD'); res.status(405).end(); });

function readerNotFoundPage(site: { slug: string; title: string } | null, version: { slug: string; title: string } | null): string {
  const siteTitle = site?.title ?? 'Docs';
  const versionTitle = version?.title ?? '';
  const title = versionTitle ? `Page not found - ${siteTitle} (${versionTitle})` : `Page not found - ${siteTitle}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/public/styles.css"></head>
<body class="reader-not-found"><main class="not-found">
<h1>${esc(copy.notFoundHeading)}</h1><p>${esc(copy.notFoundText)}</p>
<search role="search"><label class="sr-only" for="nf-search">Search the docs</label>
<input type="search" id="nf-search" role="searchbox" aria-label="Search the docs"></search>
</main><script src="/client/reader.js"></script></body></html>`;
}

function expiredPreviewPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Preview expired</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/public/styles.css"></head>
<body class="reader-not-found"><main><h1>${esc(copy.expiredPreviewHeading)}</h1></main></body></html>`;
}

// ---------- Grading routes ----------
function gradingGate(handler: (req: Request, res: Response, body: unknown) => void) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!config.gradingRoutes) { sendError(res, notFoundError()); return; }
    jsonBody(MAX_JSON_BYTES, (r2, res2, body) => handler(r2, res2, body))(req, res, next);
  };
}

app.post('/api/grading/seed', gradingGate(async (req, res, body) => {
  try {
    const result = await runSeed(body);
    sendJson(res, 201, result);
  } catch (err) {
    sendError(res, err);
  }
}));

app.post('/api/grading/outage', gradingGate(async (req, res, body) => {
  const b = body as { service?: string; ms?: number };
  const service = b?.service;
  const ms = b?.ms;
  if ((service !== 'storage' && service !== 'mail') || typeof ms !== 'number' || ms < 1 || ms > 600000) {
    sendError(res, new ApiError('validation_failed', 'Validation failed.', { fields: { service: 'Choose storage or mail.', ms: '1 to 600000.' } }));
    return;
  }
  const until = new Date(Date.now() + ms).toISOString();
  if (service === 'storage') setStorageOutage(ms);
  else setMailOutage(ms);
  sendJson(res, 200, { service, until });
}));

app.get('/docs/:siteSlug/events', async (req, res) => {
  const site = await getSiteBySlug(req.params.siteSlug);
  if (!site) { res.status(404).end(); return; }
  subscribe(res, { teamId: null, userId: null, versionId: null, pageId: null, siteId: site.id });
});

// ---------- Public search and ratings ----------
app.get('/docs/:siteSlug/:versionSlug/search', async (req, res) => {
  const site = await getSiteBySlug(req.params.siteSlug);
  if (!site) { sendError(res, notFoundError()); return; }
  const version = await getVersionBySlug(site.id, req.params.versionSlug);
  if (!version) { sendError(res, notFoundError()); return; }
  const snapshot = await liveSnapshot(version.id);
  if (!snapshot) { sendError(res, notFoundError()); return; }
  const query = String(req.query.q ?? '').trim();
  const pages = (await searchEngine.navigationOrderedPages(version.id))
    .filter((p) => snapshot.manifest.pages.some((sp) => sp.pageId === p.id));
  const base = `/docs/${site.slug}/${version.slug}`;
  const results = searchEngine.searchRank(query, pages).map((r) => ({ ...r, url: base + r.url.replace('/docs-path', '') }));
  sendJson(res, 200, { query, count: results.length, results });
});

app.post('/docs/:siteSlug/:versionSlug/search-terms', jsonBody(MAX_JSON_BYTES, async (req, res, body) => {
  const site = await getSiteBySlug(req.params.siteSlug);
  if (!site) { sendError(res, notFoundError()); return; }
  const version = await getVersionBySlug(site.id, req.params.versionSlug);
  if (!version) { sendError(res, notFoundError()); return; }
  const b = body as { term?: string };
  const term = (b?.term ?? '').trim().toLowerCase();
  if (term.length < 2) { sendError(res, new ApiError('validation_failed', 'Validation failed.', { fields: { term: 'Enter at least 2 characters.' } })); return; }
  const pages = await searchEngine.navigationOrderedPages(version.id);
  const results = searchEngine.searchRank(term, pages).length;
  await pool.query('INSERT INTO search_records (id, version_id, term, results) VALUES ($1, $2, $3, $4)', [newId('srch'), version.id, term, results]);
  events.analytics(site.team_id, site.id);
  sendJson(res, 201, { term, results });
}));

app.put('/docs/:siteSlug/ratings/:pageId', jsonBody(MAX_JSON_BYTES, async (req, res, body) => {
  const site = await getSiteBySlug(req.params.siteSlug);
  if (!site) { sendError(res, notFoundError()); return; }
  const b = body as { vote?: 'yes' | 'no' | null };
  let readerKey = cookieOf(req, READER_COOKIE);
  if (!readerKey) {
    readerKey = newToken(16);
    res.setHeader('Set-Cookie', `${READER_COOKIE}=${readerKey}; Path=/; SameSite=Lax`);
  }
  const vote = b?.vote ?? null;
  if (vote === null) {
    await pool.query('DELETE FROM votes WHERE reader_key = $1 AND page_id = $2', [readerKey, req.params.pageId]);
  } else if (vote === 'yes' || vote === 'no') {
    await pool.query(
      `INSERT INTO votes (reader_key, page_id, vote) VALUES ($1, $2, $3)
       ON CONFLICT (reader_key, page_id) DO UPDATE SET vote = EXCLUDED.vote, created_at = now()`,
      [readerKey, req.params.pageId, vote],
    );
  } else {
    sendError(res, new ApiError('validation_failed', 'Validation failed.', { fields: { vote: 'Choose yes or no.' } }));
    return;
  }
  events.analytics(site.team_id, site.id);
  sendJson(res, 200, { pageId: req.params.pageId, vote });
}));



// ---------- Public reader routes ----------
app.get('/docs/:siteSlug/:versionSlug/*', async (req, res) => {
  const site = await getSiteBySlug(req.params.siteSlug);
  if (!site) { res.status(404).send(readerNotFoundPage(null, null)); return; }
  const version = await getVersionBySlug(site.id, req.params.versionSlug);
  if (!version) { res.status(404).send(readerNotFoundPage(site, null)); return; }
  const snapshot = await liveSnapshot(version.id);
  if (!snapshot) { res.status(404).send(readerNotFoundPage(site, version)); return; }
  const requestPath = ((req.params as Record<string, string>)[0] ?? '').replace(/^\/+/, '');
  const redirects = snapshot.manifest.navigation.redirects.map((r) => ({
    from: normalizePath(r.from), to: normalizePath(r.to), kind: r.kind,
  }));
  const manual = redirects.find((r) => r.from === requestPath && r.kind === 'manual');
  if (manual) {
    res.redirect(308, `/docs/${site.slug}/${version.slug}/${manual.to}`);
    return;
  }
  const entry = snapshot.manifest.pages.find((p) => p.path === requestPath);
  if (entry) {
    const stored = await pool.query<{ html: string }>(
      'SELECT html FROM snapshot_pages WHERE snapshot_id = $1 AND path = $2',
      [snapshot.snapshotId, entry.path],
    );
    if (stored.rows[0]) { res.status(200).type('html').send(stored.rows[0].html); return; }
  }
  const auto = redirects.find((r) => r.from === requestPath && r.kind === 'auto');
  if (auto) {
    res.redirect(308, `/docs/${site.slug}/${version.slug}/${auto.to}`);
    return;
  }
  res.status(404).send(readerNotFoundPage(site, version));
});

// ---------- Static and HTML routes ----------
app.use('/public', express.static(`${serverRoot}/dist/public`, { fallthrough: true }));
app.use('/client', express.static(`${serverRoot}/dist/client`, { fallthrough: true }));
app.use('/src', (_req, res) => { res.status(404).end(); });
app.use('/node_modules', (_req, res) => { res.status(404).end(); });

const neverServed = ['/package.json', '/package-lock.json', '/run.json', '/build.mjs', '/tsconfig.json', '/THIRD_PARTY_NOTICES.md'];
for (const p of neverServed) {
  app.get(p, (_req, res) => { res.status(404).end(); });
}
app.get('/*.env', (_req, res) => { res.status(404).end(); });
app.get('/*.map', (_req, res) => { res.status(404).end(); });

app.get('/', (_req, res) => { res.redirect(302, '/app'); });
app.get('/signin', (req, res) => {
  const next = new URL(req.originalUrl, 'http://x').searchParams.get('next') ?? '';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(signinShell(next));
});
app.get('/invite/:token', async (req, res) => {
  await invites.expireInvites();
  const row = await pool.query<{ team_id: string; status: string }>(
    'SELECT team_id, status FROM invites WHERE token = $1', [req.params.token],
  );
  const invite = row.rows[0];
  if (!invite || invite.status !== 'sent') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(410).send(expiredPreviewPage());
    return;
  }
  const team = await pool.query<{ name: string }>('SELECT name FROM teams WHERE id = $1', [invite.team_id]);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(inviteShell(team.rows[0]?.name ?? 'Galley'));
});

// ---------- Authenticated /app screens ----------
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method !== 'GET' || !req.path.startsWith('/app')) { next(); return; }
  void (async () => {
    const user = await auth.getSessionUser(cookieOf(req, SESSION_COOKIE));
    if (!user) { res.redirect(302, `/signin?next=${encodeURIComponent(req.originalUrl)}`); return; }
    const path = req.path;

    if (path === '/app') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(appShell(user.teamName));
      return;
    }
    if (path === '/app/team') {
      if (user.role !== 'owner') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.status(403).send(forbiddenShell());
        return;
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(teamShell());
      return;
    }
    const analyticsMatch = path.match(/^\/app\/sites\/([^/]+)\/analytics$/);
    if (analyticsMatch) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(analyticsShell());
      return;
    }
    const redirectsMatch = path.match(/^\/app\/sites\/([^/]+)\/([^/]+)\/redirects$/);
    if (redirectsMatch) {
      const site = await getSiteBySlug(redirectsMatch[1]);
      const version = site ? await getVersionBySlug(site.id, redirectsMatch[2]) : null;
      if (!site || !version || site.team_id !== user.teamId) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.status(404).send(forbiddenShell());
        return;
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(redirectsShell(redirectsMatch[1], redirectsMatch[2], version.id));
      return;
    }
    const editorMatch = path.match(/^\/app\/sites\/([^/]+)\/([^/]+)\/pages\/(.*)$/);
    if (editorMatch) {
      const html = await editorPageFor(user, editorMatch[1], editorMatch[2], editorMatch[3]);
      if (html === null) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.status(404).send(forbiddenShell());
        return;
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(html);
      return;
    }
    res.redirect(302, '/app');
  })().catch(() => { res.status(500).send('error'); });
});

async function editorPageFor(user: auth.SessionUser, siteSlug: string, versionSlug: string, pagePath: string): Promise<string | null> {
  const site = await getSiteBySlug(siteSlug);
  if (!site || site.team_id !== user.teamId) return null;
  const version = await getVersionBySlug(site.id, versionSlug);
  if (!version) return null;
  const pageRow = await pool.query<PageRow>(
    "SELECT * FROM pages WHERE version_id = $1 AND path = $2 AND state != 'removed'", [version.id, pagePath],
  );
  const page = pageRow.rows[0];
  if (!page) {
    const nav = await navigationJson(version.id);
    const firstPageId = nav.tabs.flatMap((t) => t.groups).flatMap((g) => g.pages)[0];
    const first = firstPageId ? await getPage(firstPageId) : null;
    if (!first) return null;
    return editorPageFor(user, siteSlug, versionSlug, first.path);
  }
  const versions = await siteVersionsJson(site.id);
  const openapi = page.kind === 'reference' ? await openapiEngine.openapiInfo(version.id) : null;
  return editorShell({
    siteSlug, siteId: site.id, versionSlug, versionId: version.id, versionTitle: version.title, siteTitle: site.title,
    pagePath: page.path, pageId: page.id, role: user.role, teamName: user.teamName,
    versions: versions.map((v) => ({ id: v.id, slug: v.slug, title: v.title, default: v.default, publishedAt: v.publishedAt })),
    openapi: openapi ? { fileName: openapi.fileName, bytes: openapi.bytes, sha256: openapi.sha256 } : null,
    isReference: page.kind === 'reference',
  });
}

app.use('/api', (_req, res) => { sendError(res, notFoundError()); });

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  sendError(res, err);
});


// ---------- Seed and startup ----------
async function runSeed(body: unknown): Promise<unknown> {
  const seed = body as {
    users?: { key: string; email: string; name: string; password: string }[];
    team?: { name?: string; members?: { user: string; role: string }[] };
    sites?: {
      slug: string; title: string;
      versions?: {
        slug: string; title: string; default?: boolean; published?: boolean;
        tabs?: { title: string; groups: { title: string; pages: { path: string; title: string; source?: string }[] }[] }[];
        redirects?: { from: string; to: string; kind: string }[];
      }[];
      ratings?: { version: string; path: string; yes: number; no: number }[];
      searchTerms?: { version: string; term: string; searches: number; results: number }[];
    }[];
  };
  if (!seed?.users || !seed.team?.name || !seed.team.members || !seed.sites) {
    throw new ApiError('validation_failed', 'Validation failed.', { fields: { body: 'Send users, team and sites.' } });
  }
  for (const u of seed.users) {
    const clash = await pool.query('SELECT id FROM users WHERE email = $1', [u.email.toLowerCase()]);
    if (clash.rows.length > 0) throw new ApiError('email_in_use', 'That email already has an account.');
  }
  const teamId = newId('tm');
  await pool.query('INSERT INTO teams (id, name) VALUES ($1, $2)', [teamId, seed.team.name]);
  const userIds = new Map<string, string>();
  for (const u of seed.users) {
    const id = newId('usr');
    userIds.set(u.key, id);
    const member = seed.team.members.find((m) => m.user === u.key);
    await pool.query(
      'INSERT INTO users (id, team_id, email, name, password_hash, role) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, teamId, u.email.toLowerCase(), u.name, await auth.hashPassword(u.password), member?.role ?? 'viewer'],
    );
  }
  const sitesOut: Record<string, unknown> = {};
  for (const siteSpec of seed.sites) {
    const siteId = newId('site');
    const siteClash = await pool.query('SELECT id FROM sites WHERE slug = $1 AND team_id = $2', [siteSpec.slug, teamId]);
    if (siteClash.rows.length === 0) {
      const anySite = await pool.query('SELECT id FROM sites WHERE slug = $1', [siteSpec.slug]);
      if (anySite.rows.length > 0) throw new ApiError('slug_taken', `Another site already uses ${siteSpec.slug}.`);
    }
    await pool.query('INSERT INTO sites (id, team_id, slug, title) VALUES ($1, $2, $3, $4)', [siteId, teamId, siteSpec.slug, siteSpec.title]);
    const versionsOut: Record<string, unknown> = {};
    const publishOut: Record<string, string> = {};
    let defaultVersionId: string | null = null;
    for (const vSpec of siteSpec.versions ?? []) {
      const versionId = newId('ver');
      const spec: { id: string; slug: string; title: string } = { id: versionId, slug: vSpec.slug, title: vSpec.title };
      await createSeedVersion(siteId, versionId, vSpec);
      const tabIds: Record<string, string> = {};
      const groupIds: Record<string, string> = {};
      const pageIds: Record<string, string> = {};
      const pageList: { id: string; path: string; title: string }[] = [];
      await fillSeedMaps(versionId, vSpec, tabIds, groupIds, pageIds, pageList);
      if (vSpec.default) defaultVersionId = versionId;
      for (const rating of siteSpec.ratings ?? []) {
        if (rating.version !== vSpec.slug) continue;
        const pageId = pageIds[rating.path];
        if (!pageId) continue;
        for (let i = 0; i < rating.yes; i++) {
          await pool.query('INSERT INTO votes (reader_key, page_id, vote) VALUES ($1, $2, $3)', [`seed-yes-${rating.path}-${i}-${versionId}`, pageId, 'yes']);
        }
        for (let i = 0; i < rating.no; i++) {
          await pool.query('INSERT INTO votes (reader_key, page_id, vote) VALUES ($1, $2, $3)', [`seed-no-${rating.path}-${i}-${versionId}`, pageId, 'no']);
        }
      }
      for (const term of siteSpec.searchTerms ?? []) {
        if (term.version !== vSpec.slug) continue;
        for (let i = 0; i < term.searches; i++) {
          await pool.query('INSERT INTO search_records (id, version_id, term, results) VALUES ($1, $2, $3, $4)', [newId('srch'), versionId, term.term, term.results]);
        }
      }
      if (vSpec.published) {
        try {
          const report = await publishEngine.publishVersion(versionId, newToken(16));
          publishOut[vSpec.slug] = report.status;
          if (report.status === 'published') {
            await pool.query('UPDATE pages SET state = $2 WHERE version_id = $1', [versionId, 'published']);
          }
        } catch (err) {
          if (err instanceof ApiError && err.code === 'publish_blocked') {
            publishOut[vSpec.slug] = 'blocked';
          } else {
            publishOut[vSpec.slug] = 'failed';
          }
        }
      }
      versionsOut[vSpec.slug] = { id: versionId, tabs: tabIds, groups: groupIds, pages: pageIds, pageList };
      void spec;
    }
    if (defaultVersionId) {
      await pool.query('UPDATE sites SET default_version_id = $2 WHERE id = $1', [siteId, defaultVersionId]);
    }
    sitesOut[siteSpec.slug] = { id: siteId, publish: publishOut, versions: versionsOut };
  }
  return { users: Object.fromEntries([...userIds.entries()]), teamId, sites: sitesOut };
}

async function createSeedVersion(
  siteId: string, versionId: string,
  vSpec: { slug: string; title: string; tabs?: { title: string; groups: { title: string; pages: { path: string; title: string; source?: string }[] }[] }[]; redirects?: { from: string; to: string; kind: string }[] },
): Promise<void> {
  await pool.query('INSERT INTO versions (id, site_id, slug, title, position) VALUES ($1, $2, $3, $4, 0)', [versionId, siteId, vSpec.slug, vSpec.title]);
  let pagePos = 0;
  for (const tSpec of vSpec.tabs ?? []) {
    const tabId = newId('tab');
    await pool.query('INSERT INTO tabs (id, version_id, title, position) VALUES ($1, $2, $3, $4)', [tabId, versionId, tSpec.title, 0]);
    for (const gSpec of tSpec.groups) {
      const groupId = newId('grp');
      await pool.query('INSERT INTO groups (id, tab_id, title, position) VALUES ($1, $2, $3, $4)', [groupId, tabId, gSpec.title, 0]);
      for (const pSpec of gSpec.pages) {
        const pageId = newId('pg');
        await pool.query(
          `INSERT INTO pages (id, version_id, group_id, position, path, title, kind, source, revision, state, has_draft_changes)
           VALUES ($1, $2, $3, $4, $5, $6, 'page', $7, 0, 'draft', true)`,
          [pageId, versionId, groupId, pagePos++, pSpec.path, pSpec.title, pSpec.source ?? `## ${pSpec.title}\n\n`],
        );
      }
    }
  }
  for (const rSpec of vSpec.redirects ?? []) {
    await pool.query(
      'INSERT INTO redirects (id, version_id, from_path, to_path, kind) VALUES ($1, $2, $3, $4, $5)',
      [newId('red'), versionId, normalizePath(rSpec.from), normalizePath(rSpec.to), rSpec.kind],
    );
  }
}

async function fillSeedMaps(
  versionId: string,
  vSpec: { tabs?: { title: string; groups: { title: string; pages: { path: string; title: string; source?: string }[] }[] }[] },
  tabIds: Record<string, string>, groupIds: Record<string, string>, pageIds: Record<string, string>,
  pageList: { id: string; path: string; title: string }[],
): Promise<void> {
  const tabs = await pool.query<{ id: string; title: string }>('SELECT id, title FROM tabs WHERE version_id = $1 ORDER BY position', [versionId]);
  for (const tab of tabs.rows) tabIds[tab.title] = tab.id;
  const groups = await pool.query<{ id: string; title: string }>(
    'SELECT id, title FROM groups WHERE tab_id = ANY($1) ORDER BY position', [tabs.rows.map((t) => t.id)],
  );
  for (const g of groups.rows) groupIds[g.title] = g.id;
  const pages = await pool.query<{ id: string; path: string; title: string }>(
    "SELECT id, path, title FROM pages WHERE version_id = $1 AND state != 'removed' ORDER BY position", [versionId],
  );
  for (const p of pages.rows) {
    if (!(p.path in pageIds)) pageIds[p.path] = p.id;
    pageList.push({ id: p.id, path: p.path, title: p.title });
  }
}

async function seedDemoData(): Promise<void> {
  const existing = await pool.query('SELECT count(*)::int AS n FROM teams');
  if (existing.rows[0].n > 0) return;
  const demo = {
    users: [
      { key: 'owner', email: 'ines@quire.test', name: 'Ines Varga', password: 'quire-owner-2026' },
      { key: 'ed', email: 'dara@quire.test', name: 'Dara Okafor', password: 'quire-editor-2026' },
      { key: 'view', email: 'lev@quire.test', name: 'Lev Marsh', password: 'quire-viewer-2026' },
    ],
    team: { name: 'Quire Labs', members: [{ user: 'owner', role: 'owner' }, { user: 'ed', role: 'editor' }, { user: 'view', role: 'viewer' }] },
    sites: [{
      slug: 'quire', title: 'Quire Docs',
      versions: [
        {
          slug: 'v1', title: 'Version 1', default: false, published: true,
          tabs: [
            { title: 'Guides', groups: [
              { title: 'Getting started', pages: [
                { path: 'introduction', title: 'Introduction', source: DEMO_INTRODUCTION },
                { path: 'guides/install', title: 'Install', source: DEMO_INSTALL },
                { path: 'guides/configure', title: 'Configure', source: DEMO_CONFIGURE },
              ] },
              { title: 'Publishing', pages: [{ path: 'guides/publish', title: 'Publishing', source: DEMO_PUBLISH }] },
            ] },
            { title: 'Reference', groups: [{ title: 'CLI', pages: [{ path: 'reference/cli', title: 'CLI', source: DEMO_CLI }] }] },
          ],
        },
        {
          slug: 'v2', title: 'Version 2', default: true, published: true,
          tabs: [
            { title: 'Guides', groups: [
              { title: 'Getting started', pages: [
                { path: 'introduction', title: 'Introduction', source: DEMO_INTRODUCTION },
                { path: 'guides/install', title: 'Install', source: DEMO_INSTALL },
                { path: 'guides/configure', title: 'Configure', source: DEMO_CONFIGURE },
                { path: 'guides/themes', title: 'Themes', source: DEMO_THEMES },
              ] },
              { title: 'Publishing', pages: [{ path: 'guides/publish', title: 'Publishing', source: DEMO_PUBLISH }] },
            ] },
            { title: 'Reference', groups: [{ title: 'CLI', pages: [{ path: 'reference/cli', title: 'CLI', source: DEMO_CLI }] }] },
          ],
          redirects: [{ from: '/setup', to: '/guides/install', kind: 'auto' }],
        },
      ],
      ratings: [{ version: 'v2', path: 'introduction', yes: 7, no: 2 }],
      searchTerms: [{ version: 'v2', term: 'install', searches: 5, results: 3 }],
    }],
  };
  try {
    await runSeed(demo);
  } catch {
    // demo data is best-effort; ignore failures
  }
}

const DEMO_INTRODUCTION = `## Overview

Welcome to Quire. This page shows every component once.

<Callout type="note">
Notes point out things worth knowing.
</Callout>

## Components

<Tabs>
<Tab title="First">
The first tab.
</Tab>
<Tab title="Second">
The second tab.
</Tab>
</Tabs>

<CodeGroup>
\`\`\`bash Shell
npm install quire
\`\`\`
\`\`\`js JavaScript
quire.run();
\`\`\`
</CodeGroup>

<Steps>
<Step title="Install">
Install the package first.
</Step>
<Step title="Configure">
Then set your options.
</Step>
</Steps>

<Accordion title="Why Quire?">
Because docs should stay whole.
</Accordion>

<Cards>
<Card title="Install" href="/guides/install">
Start here.
</Card>
</Cards>

See [Install](/guides/install#requirements).
`;

const DEMO_INSTALL = `## Requirements

Linux or macOS.

## Steps

1. Download the archive
2. Run the installer
`;

const DEMO_CONFIGURE = `## Settings

Edit \`quire.json\`.
`;

const DEMO_PUBLISH = `## Steps

Press Publish.
`;

const DEMO_CLI = `## Commands

\`\`\`bash
quire build
\`\`\`
`;

const DEMO_THEMES = `## Light and dark

Pick a theme in the sidebar.
`;

// ---------- Boot ----------
async function start(): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    try {
      await applySchema();
      break;
    } catch (err) {
      if (Date.now() - startedAt > 60000) {
        console.error('Postgres unreachable after 60s:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  await seedDemoData();
  try {
    await ensureBucket();
  } catch {
    // MinIO may be down; outage behaviour applies
  }
  invites.startRetryLoop();
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`Galley listening on port ${config.port}`);
  });
}

void start();

