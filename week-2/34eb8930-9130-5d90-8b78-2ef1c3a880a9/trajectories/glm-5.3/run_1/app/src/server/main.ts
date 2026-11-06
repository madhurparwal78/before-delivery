import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
import { WebSocketServer, type WebSocket } from 'ws';
import pg from 'pg';
import { config, hashPassword, newId, newSessionToken, sessionExpiresAt } from './config.js';
import { ApiError, errorBody, forbidden, invalid, notFound, tooLarge, unsupportedMediaType, crossOrigin, conflict, storageUnavailable } from './errors.js';
import { applySchema, seedDocuments, seedPeople } from './seed.js';
import { writeSeedObjects } from './seedbody.js';
import * as store from './store.js';
import * as service from './service.js';
import * as sockets from './sockets.js';
import type { DomainRole } from '../domain/types.js';
import { roleCan } from '../domain/types.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const pool = new pg.Pool({ connectionString: config.databaseUrl });
let dbReady = false;

async function connectDb(): Promise<void> {
  for (;;) {
    try {
      await pool.query('SELECT 1');
      await applySchema(pool);
      await seedPeople(pool);
      await seedDocuments(pool);
      dbReady = true;
      // seed objects are written on every serve; the app keeps serving and retries while storage is unreachable
      void writeSeedObjects(pool);
      sockets.startSweep(pool);
      return;
    } catch {
      dbReady = false;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

type Ctx = {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  body: unknown;
  person: service.PersonRow | null;
  cookie: string | null;
};

function parseCookies(req: http.IncomingMessage): Map<string, string> {
  const out = new Map<string, string>();
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out.set(part.slice(0, idx).trim(), part.slice(idx + 1).trim());
  }
  return out;
}

async function personFromCookies(req: http.IncomingMessage): Promise<{ person: service.PersonRow | null; token: string | null }> {
  const cookies = parseCookies(req);
  const token = cookies.get('qm_session') ?? null;
  if (!token) return { person: null, token: null };
  const row = await pool.query(
    `SELECT p.person_id, p.display_name, p.email, p.colour, p.is_consultant FROM sessions s
     JOIN people p ON p.person_id = s.person_id WHERE s.token = $1 AND s.expires_at > now()`,
    [token],
  );
  if (!row.rowCount) return { person: null, token: null };
  return { person: row.rows[0] as service.PersonRow, token };
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(payload);
}

function sendError(res: http.ServerResponse, err: unknown): void {
  if (err instanceof ApiError) {
    if (err.status === 401) clearSessionCookie(res);
    sendJson(res, err.status, errorBody(err));
    return;
  }
  sendJson(res, 500, { error: 'internal' });
}

function setSessionCookie(res: http.ServerResponse, token: string): void {
  res.setHeader('Set-Cookie', `qm_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${12 * 3600}`);
}

function clearSessionCookie(res: http.ServerResponse): void {
  if (res.headersSent) return;
  res.setHeader('Set-Cookie', 'qm_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

/** The error order holds for every route: origin, body type and size, session, access, role, conflict, validation. */
async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const contentType = req.headers['content-type'] ?? '';
  const hasBody = req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT';
  if (!hasBody) return undefined;
  if (!/^application\/json/i.test(contentType)) throw unsupportedMediaType();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 65_536) {
      throw tooLarge();
    }
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf-8');
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw invalid({});
  }
}

function checkOrigin(req: http.IncomingMessage): void {
  const origin = req.headers.origin;
  if (!origin) return;
  const host = req.headers.host;
  try {
    const originUrl = new URL(origin);
    if (!host || originUrl.host !== host) throw crossOrigin();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw crossOrigin();
  }
}

function requireField(body: Record<string, unknown>, field: string, message: string): string {
  const value = body[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    const fields: Record<string, string> = {};
    fields[field] = message;
    throw invalid(fields);
  }
  return value;
}

function requirePerson(ctx: Ctx): service.PersonRow {
  if (!ctx.person) {
    throw new ApiError(401, 'unauthenticated');
  }
  return ctx.person;
}

function requireDoc(pool2: typeof pool, documentId: string, personId: string): Promise<{ doc: store.LiveDoc; access: service.DocAccess }> {
  void pool2;
  return (async () => {
    const access = await service.requireAccess(pool, documentId, personId);
    const loaded = await store.loadDocument(pool, documentId);
    if (!loaded.ok) {
      if (loaded.reason === 'storage_unavailable') throw storageUnavailable();
      throw notFound();
    }
    return { doc: loaded.doc, access };
  })();
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;
    checkOrigin(req);

    // health answers before any session check
    if (path === '/api/health') {
      if (!dbReady) {
        sendJson(res, 503, { status: 'starting' });
      } else {
        sendJson(res, 200, { status: 'ok' });
      }
      return;
    }

    if (path.startsWith('/api/')) {
      if (!dbReady) {
        sendJson(res, 503, { error: 'starting' });
        return;
      }
      const body = await readBody(req);
      const auth = await personFromCookies(req);
      const ctx: Ctx = { req, res, body: body as Record<string, unknown>, person: auth.person, cookie: auth.token };
      await route(ctx);
      return;
    }

    serveStatic(path, res);
  } catch (err) {
    sendError(res, err);
  }
});

function serveStatic(path: string, res: http.ServerResponse): void {
  let file = path === '/' ? '/index.html' : path;
  file = normalize(file).replace(/^(\.\.[/\\])+/, '');
  if (file.includes('..')) {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }
  // source files and anything outside the built assets are never served
  if (/\.(ts|map|json\.orig)$/.test(file) && !file.startsWith('/assets/') && file !== '/manifest.json') {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }
  if (file.startsWith('/run') || file.startsWith('/package') || file.startsWith('/.env') || file.startsWith('/src') || file.startsWith('/tsconfig') || file.startsWith('/node_modules')) {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }
  const full = join(here, '..', 'browser', file);
  if (!existsSync(full) || !statSync(full).isFile()) {
    // SPA routes
    const index = join(here, '..', 'browser', 'index.html');
    if (existsSync(index)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(readFileSync(index));
      return;
    }
    sendJson(res, 404, { error: 'not_found' });
    return;
  }
  const type = MIME[extname(full)] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(readFileSync(full));
}

async function route(ctx: Ctx): Promise<void> {
  const { req, res } = ctx;
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;
  const parts = path.split('/').filter(Boolean); // ['api', ...]

  // ---- session ----
  if (parts[1] === 'session' && parts.length === 2) {
    if (method === 'POST') {
      const body = ctx.body as Record<string, unknown>;
      const email = requireField(body, 'email', 'Enter your email.');
      const password = requireField(body, 'password', 'Enter your password.');
      const row = await pool.query(`SELECT * FROM people WHERE lower(email) = lower($1)`, [email]);
      const person = row.rows[0] as (service.PersonRow & { password_hash: string }) | undefined;
      if (!person || person.password_hash !== hashPassword(password)) {
        throw new ApiError(401, 'invalid_credentials');
      }
      const token = newSessionToken();
      await pool.query(`INSERT INTO sessions (token, person_id, expires_at) VALUES ($1,$2,$3)`, [token, person.person_id, sessionExpiresAt(new Date())]);
      setSessionCookie(res, token);
      sendJson(res, 200, {
        person: { personId: person.person_id, displayName: person.display_name, email: person.email, colour: person.colour, isConsultant: person.is_consultant },
      });
      return;
    }
    if (method === 'GET') {
      const person = requirePerson(ctx);
      sendJson(res, 200, {
        person: { personId: person.person_id, displayName: person.display_name, email: person.email, colour: person.colour, isConsultant: person.is_consultant },
      });
      return;
    }
    if (method === 'DELETE') {
      if (ctx.cookie) {
        await pool.query(`DELETE FROM sessions WHERE token = $1`, [ctx.cookie]);
      }
      clearSessionCookie(res);
      res.writeHead(204);
      res.end();
      return;
    }
  }

  // ---- documents ----
  if (parts[1] === 'documents' && parts.length === 2) {
    const person = requirePerson(ctx);
    if (method === 'GET') {
      const viewParam = url.searchParams.get('view');
      if (viewParam !== null && !['recent', 'mine', 'shared'].includes(viewParam)) throw invalid({ view: 'Choose a list.' });
      const q = url.searchParams.get('q') ?? undefined;
      let documents: Record<string, unknown>[];
      if (viewParam === 'recent') {
        documents = await listRecent(pool, person.person_id);
      } else {
        documents = await service.listDocuments(pool, person.person_id, (viewParam as 'recent' | 'mine' | 'shared' | undefined) ?? undefined, q);
      }
      sendJson(res, 200, { documents });
      return;
    }
    if (method === 'POST') {
      if (!person.is_consultant) throw forbidden();
      const body = ctx.body as Record<string, unknown>;
      const title = requireField(body, 'title', 'Enter a title of 1 to 120 characters.');
      const client = requireField(body, 'client', 'Enter a client name of 1 to 80 characters.');
      if (title.length > 120) throw invalid({ title: 'Enter a title of 1 to 120 characters.' });
      if (client.length > 80) throw invalid({ client: 'Enter a client name of 1 to 80 characters.' });
      const id = newId();
      const doc = await store.createDocument(pool, id, title, client, person.person_id);
      sendJson(res, 201, {
        id: doc.id,
        title: doc.title,
        client: doc.client,
        role: 'owner',
        updatedAt: new Date().toISOString(),
        owner: { personId: person.person_id, displayName: person.display_name, colour: person.colour, role: 'owner' },
      });
      return;
    }
  }

  if (parts[1] === 'documents' && parts.length === 3) {
    const person = requirePerson(ctx);
    const documentId = parts[2]!;
    const { doc, access } = await requireDoc(pool, documentId, person.person_id);
    if (method === 'GET') {
      const snapshot = await service.buildSnapshot(pool, doc, access);
      (snapshot.myAccess as Record<string, unknown>).mode = await service.storedMode(pool, documentId, person.person_id, access.role);
      (snapshot as Record<string, unknown>).wordCount = undefined;
      await service.touchRecent(pool, person.person_id, documentId);
      sendJson(res, 200, snapshot);
      return;
    }
    if (method === 'PATCH') {
      if (access.role !== 'owner') throw forbidden();
      const body = ctx.body as Record<string, unknown>;
      let title = doc.title;
      let client = doc.client;
      if (body.title !== undefined) {
        if (typeof body.title !== 'string' || body.title.trim().length === 0 || body.title.length > 120) throw invalid({ title: 'Enter a title of 1 to 120 characters.' });
        title = body.title;
      }
      if (body.client !== undefined) {
        if (typeof body.client !== 'string' || body.client.trim().length === 0 || body.client.length > 80) throw invalid({ client: 'Enter a client name of 1 to 80 characters.' });
        client = body.client;
      }
      await pool.query(`UPDATE documents SET title = $2, client = $3, updated_at = now() WHERE id = $1`, [documentId, title, client]);
      doc.title = title;
      doc.client = client;
      for (const [, sockets] of doc.joined) {
        for (const s of sockets) s.send({ type: 'title_changed', title, client });
      }
      sendJson(res, 200, {
        id: doc.id,
        title: doc.title,
        client: doc.client,
        role: access.role,
        updatedAt: new Date().toISOString(),
        owner: { personId: doc.ownerId, displayName: '', colour: '', role: 'owner' },
      });
      return;
    }
    if (method === 'DELETE') {
      if (access.role !== 'owner') throw forbidden();
      await deleteDocumentFlow(doc, person);
      res.writeHead(204);
      res.end();
      return;
    }
  }

  // ---- shares ----
  if (parts[1] === 'documents' && parts[2] && parts[3] === 'shares') {
    const person = requirePerson(ctx);
    const documentId = parts[2];
    const { doc, access } = await requireDoc(pool, documentId, person.person_id);
    if (parts.length === 4 && method === 'GET') {
      sendJson(res, 200, await service.listShares(pool, doc, access.role));
      return;
    }
    if (parts.length === 4 && method === 'POST') {
      if (access.role !== 'owner') throw forbidden();
      const body = ctx.body as Record<string, unknown>;
      const email = requireField(body, 'email', 'No Quillmere account uses this email.');
      const role = body.role;
      if (role !== 'editor' && role !== 'commenter' && role !== 'viewer') throw invalid({ role: 'Choose Editor, Commenter or Viewer.' });
      const endsRaw = body.endsAt;
      let endsAt: string | null = null;
      if (typeof endsRaw === 'string' && endsRaw.length > 0) {
        const t = Date.parse(endsRaw);
        if (Number.isNaN(t) || t <= Date.now()) throw invalid({ endsAt: 'Pick an end time in the future.' });
        if (t > Date.now() + 365 * 24 * 3600 * 1000) throw invalid({ endsAt: 'Pick an end time within a year.' });
        endsAt = new Date(t).toISOString();
      }
      const share = await service.createShare(pool, doc, person, email, role, endsAt);
      const notice = await service.addNotice(pool, share.granteeId, 'shared', doc, person, role, `${person.display_name} shared ${doc.title} with you as ${service.roleLabel(role)}`);
      sockets.pushNotice(share.granteeId, notice);
      sendJson(res, 201, { shareId: share.shareId, person: share.person, email: share.email, role, endsAt, status: 'active' });
      return;
    }
    if (parts.length === 5 && method === 'PATCH') {
      if (access.role !== 'owner') throw forbidden();
      const body = ctx.body as Record<string, unknown>;
      const role = body.role as DomainRole | undefined;
      if (role !== undefined && role !== 'editor' && role !== 'commenter' && role !== 'viewer') throw invalid({ role: 'Choose Editor, Commenter or Viewer.' });
      const endsRaw = body.endsAt;
      let endsAt: string | null | undefined = undefined;
      if (typeof endsRaw === 'string' && endsRaw.length > 0) {
        const t = Date.parse(endsRaw);
        if (Number.isNaN(t) || t <= Date.now()) throw invalid({ endsAt: 'Pick an end time in the future.' });
        if (t > Date.now() + 365 * 24 * 3600 * 1000) throw invalid({ endsAt: 'Pick an end time within a year.' });
        endsAt = new Date(t).toISOString();
      } else if (endsRaw === null) {
        endsAt = null;
      }
      const updated = await service.updateShare(pool, doc, parts[4]!, role, endsAt);
      if (updated.roleChanged && updated.granteeId) {
        await sockets.notifyRoleChange(pool, doc, updated.granteeId, updated.role as DomainRole);
      }
      sockets.listsChangedFor(updated.granteeId ? [updated.granteeId] : []);
      sendJson(res, 200, { shareId: updated.shareId, person: updated.person, email: updated.email, role: updated.role, endsAt: updated.endsAt, status: 'active' });
      return;
    }
    if (parts.length === 5 && method === 'DELETE') {
      if (access.role !== 'owner') throw forbidden();
      const removedId = await service.removeShare(pool, doc, parts[4]!);
      if (removedId) {
        await sockets.broadcastAccessEnded(doc, 'removed', [removedId]);
      }
      res.writeHead(204);
      res.end();
      return;
    }
  }

  // ---- people picker ----
  if (parts[1] === 'documents' && parts[2] && parts[3] === 'people') {
    const person = requirePerson(ctx);
    const documentId = parts[2];
    await service.requireAccess(pool, documentId, person.person_id);
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const roles = await service.docRoles(pool, documentId);
    const people: Record<string, unknown>[] = [];
    for (const [pid, role] of roles) {
      const p = await service.personById(pool, pid);
      if (!p) continue;
      if (q && !p.display_name.toLowerCase().includes(q)) continue;
      people.push(service.personObject(p, role));
    }
    sendJson(res, 200, { people });
    return;
  }

  // ---- decisions ----
  if (parts[1] === 'documents' && parts[2] && parts[3] === 'suggestions' && parts[4] && parts[5] === 'decision') {
    const person = requirePerson(ctx);
    const documentId = parts[2];
    const { doc, access } = await requireDoc(pool, documentId, person.person_id);
    if (method !== 'POST') throw notFound();
    if (!roleCan(access.role, 'decide')) throw forbidden();
    const body = ctx.body as Record<string, unknown>;
    const decision = body.decision;
    if (decision !== 'accept' && decision !== 'reject') throw invalid({ decision: 'Choose accept or reject.' });
    const result = await store.enqueue(doc, () => store.decideSuggestion(pool, doc, parts[4]!, decision, person.person_id));
    if (!result) {
      const sug = doc.model.suggestions.find((s) => s.id === parts[4]);
      if (!sug) throw notFound();
      sendJson(res, 200, { suggestionId: parts[4], status: sug.status, applied: false, decidedBy: null, revision: doc.model.revision });
      return;
    }
    store.broadcastDoc(doc, { type: 'card_closed', cardId: parts[4], status: result.status, decidedBy: { personId: person.person_id, displayName: person.display_name, colour: person.colour, role: access.role } });
    const wireOps = toWire(result.delta.textOps);
    for (const [, socketSet] of doc.joined) {
      for (const s of socketSet) s.send({ type: 'op', revision: doc.model.revision, authorId: person.person_id, mode: 'editing', ops: wireOps });
    }
    sendJson(res, 200, {
      suggestionId: parts[4],
      status: result.status,
      applied: true,
      decidedBy: { personId: person.person_id, displayName: person.display_name, colour: person.colour, role: access.role },
      revision: doc.model.revision,
    });
    return;
  }

  if (parts[1] === 'documents' && parts[2] && parts[3] === 'decisions') {
    const person = requirePerson(ctx);
    const documentId = parts[2];
    const { doc, access } = await requireDoc(pool, documentId, person.person_id);
    if (method !== 'POST') throw notFound();
    if (!roleCan(access.role, 'decide')) throw forbidden();
    const body = ctx.body as Record<string, unknown>;
    const decision = body.decision;
    if (decision !== 'accept' && decision !== 'reject') throw invalid({ decision: 'Choose accept or reject.' });
    const result = await store.enqueue(doc, () => store.decideAll(pool, doc, decision, person.person_id));
    const decidedBy = { personId: person.person_id, displayName: person.display_name, colour: person.colour, role: access.role };
    for (const sid of result.suggestionIds) {
      store.broadcastDoc(doc, { type: 'card_closed', cardId: sid, status: decision === 'accept' ? 'accepted' : 'rejected', decidedBy });
    }
    const wireOps = toWire(result.delta.textOps);
    for (const [, socketSet] of doc.joined) {
      for (const s of socketSet) s.send({ type: 'op', revision: doc.model.revision, authorId: person.person_id, mode: 'editing', ops: wireOps });
    }
    sendJson(res, 200, { decision, count: result.count, suggestionIds: result.suggestionIds, revision: doc.model.revision });
    return;
  }

  // ---- comments ----
  if (parts[1] === 'documents' && parts[2] && parts[3] === 'comments') {
    const person = requirePerson(ctx);
    const documentId = parts[2];
    const { doc, access } = await requireDoc(pool, documentId, person.person_id);
    if (parts.length === 4 && method === 'POST') {
      if (!roleCan(access.role, 'comment')) throw forbidden();
      const body = ctx.body as Record<string, unknown>;
      const raw = body.body;
      const text = typeof raw === 'string' ? raw.trim() : '';
      if (text.length < 1 || text.length > 2000) throw invalid({ body: 'Write a comment of 1 to 2,000 characters.' });
      const parentId = typeof body.parentId === 'string' ? body.parentId : undefined;
      let anchor: { at: number; length: number } | null = null;
      if (!parentId) {
        const a = body.anchor as { at?: unknown; length?: unknown } | undefined;
        if (!a || typeof a.at !== 'number' || typeof a.length !== 'number' || a.length < 1 || a.at < 0 || a.at + a.length > doc.model.text.length) {
          throw invalid({ anchor: 'Select the text this comment is about.' });
        }
        anchor = { at: a.at, length: a.length };
      }
      const mentionsRaw = Array.isArray(body.mentions) ? body.mentions : [];
      const roles = await service.docRoles(pool, documentId);
      const mentions: string[] = [];
      for (const m of mentionsRaw) {
        if (typeof m !== 'string' || !roles.has(m)) throw invalid({ mentions: 'Only people with access to this proposal can be mentioned.' });
        mentions.push(m);
      }
      const commentId = newId();
      const createdAt = new Date().toISOString();
      if (parentId) {
        const parent = doc.model.comments.find((c) => c.id === parentId);
        if (!parent) throw notFound();
        await pool.query(`INSERT INTO comment_replies (id, comment_id, author_id, body, created_at) VALUES ($1,$2,$3,$4,now())`, [commentId, parentId, person.person_id, text]);
        parent.replies.push({ id: commentId, authorId: person.person_id, body: text, createdAt });
        const people = await loadDocPeople(pool, documentId);
        const card = service.commentObject(parent, people, roles);
        store.broadcastDoc(doc, { type: 'card_changed', card });
        sendJson(res, 201, card);
        return;
      }
      await pool.query(
        `INSERT INTO comments (id, document_id, author_id, body, mentions, anchor, content_deleted, status, created_at, parent_id)
         VALUES ($1,$2,$3,$4,$5,$6,false,'open',now(),NULL)`,
        [commentId, documentId, person.person_id, text, JSON.stringify(mentions), anchor ? JSON.stringify(anchor) : null],
      );
      const comment = {
        id: commentId,
        authorId: person.person_id,
        body: text,
        mentions,
        anchor,
        contentDeleted: false,
        status: 'open' as const,
        replies: [],
        createdAt,
      };
      doc.model.comments.push(comment);
      const people = await loadDocPeople(pool, documentId);
      const card = service.commentObject(comment, people, roles);
      store.broadcastDoc(doc, { type: 'card_added', card });
      // mention notices (DP-29)
      for (const pid of mentions) {
        if (pid === person.person_id) continue;
        const notice = await service.addNotice(pool, pid, 'mention', doc, person, roles.get(pid) ?? null, `${person.display_name} mentioned you in ${doc.title}`, commentId);
        sockets.pushNotice(pid, notice);
      }
      sendJson(res, 201, card);
      return;
    }
    if (parts.length === 5 && (parts[5] === 'resolve' || parts[5] === 'reopen')) {
      if (!roleCan(access.role, 'comment')) throw forbidden();
      const comment = doc.model.comments.find((c) => c.id === parts[4]);
      if (!comment) throw notFound();
      if (parts[5] === 'resolve') {
        if (comment.status !== 'open' && comment.status !== 'reopened') throw conflict('not_open');
        comment.status = 'resolved';
      } else {
        if (comment.status !== 'resolved') throw conflict('not_resolved');
        comment.status = 'reopened';
      }
      await pool.query(`UPDATE comments SET status = $2 WHERE id = $1`, [comment.id, comment.status]);
      const roles = await service.docRoles(pool, documentId);
      const people = await loadDocPeople(pool, documentId);
      store.broadcastDoc(doc, { type: 'card_changed', card: service.commentObject(comment, people, roles) });
      sendJson(res, 200, service.commentObject(comment, people, roles));
      return;
    }
  }

  // ---- notices ----
  if (parts[1] === 'notices') {
    const person = requirePerson(ctx);
    if (parts.length === 2 && method === 'GET') {
      sendJson(res, 200, await service.listNotices(pool, person.person_id));
      return;
    }
    if (parts.length === 4 && parts[3] === 'read' && method === 'POST') {
      const row = await pool.query(`SELECT id FROM notices WHERE id = $1 AND person_id = $2`, [parts[2], person.person_id]);
      if (!row.rowCount) throw notFound();
      await pool.query(`UPDATE notices SET read = true WHERE id = $1`, [parts[2]]);
      const notices = await service.listNotices(pool, person.person_id);
      const notice = notices.notices.find((n) => n.id === parts[2]) ?? { ...notices.notices[0], read: true, id: parts[2] };
      sendJson(res, 200, { ...notice, read: true });
      return;
    }
  }

  throw notFound();
}

async function loadDocPeople(poolRef: typeof pool, documentId: string): Promise<Map<string, service.PersonRow>> {
  const roles = await service.docRoles(poolRef, documentId);
  const people = new Map<string, service.PersonRow>();
  for (const pid of roles.keys()) {
    const p = await service.personById(poolRef, pid);
    if (p) people.set(pid, p);
  }
  return people;
}

async function listRecent(poolRef: typeof pool, personId: string): Promise<Record<string, unknown>[]> {
  const rows = await poolRef.query(
    `SELECT r.document_id FROM recent r WHERE r.person_id = $1 ORDER BY r.opened_at DESC LIMIT 10`,
    [personId],
  );
  const out: Record<string, unknown>[] = [];
  for (const r of rows.rows as { document_id: string }[]) {
    const access = await service.accessFor(poolRef, r.document_id, personId);
    if (!access) continue;
    const docs = await service.listDocuments(poolRef, personId, undefined, undefined);
    const found = docs.find((d) => d.id === r.document_id);
    if (found) out.push(found);
  }
  return out;
}

/** Deleting a proposal removes its object first, then its records (DP-38). */
async function deleteDocumentFlow(doc: store.LiveDoc, person: service.PersonRow): Promise<void> {
  const affected = [...doc.joined.keys()];
  try {
    await store.deleteBody(doc.id);
  } catch {
    throw storageUnavailable();
  }
  await pool.query(`DELETE FROM notices WHERE document_id = $1`, [doc.id]);
  await pool.query(`DELETE FROM documents WHERE id = $1`, [doc.id]);
  store.liveDocs.delete(doc.id);
  const ownerSockets = new Set<string>([doc.ownerId, ...affected]);
  sockets.listsChangedFor(ownerSockets);
  for (const [, socketSet] of doc.joined) {
    for (const s of socketSet) s.send({ type: 'access_ended', reason: 'deleted' });
  }
  for (const pid of [...doc.joined.keys()]) {
    for (const s of [...(doc.joined.get(pid) ?? [])]) {
      try {
        (s.ws ?? { close: () => undefined }).close();
      } catch {
        // already closed
      }
    }
  }
  void person;
}

function toWire(ops: { ins?: string; del?: number; at?: number }[]): unknown[] {
  const out: unknown[] = [];
  for (const op of ops) {
    if ('ins' in op) out.push({ insert: op.ins, at: op.at });
    else if ('del' in op) out.push({ delete: op.del, at: op.at });
    else out.push(op);
  }
  return out;
}

// ---- websocket upgrade ----
const wss = new WebSocketServer({ noServer: true, maxPayload: 65_536 });

server.on('upgrade', async (req, socket, head) => {
  try {
    const origin = req.headers.origin;
    const host = req.headers.host;
    if (!origin || !host) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    try {
      const originUrl = new URL(origin);
      if (originUrl.host !== host) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
    } catch {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    if (!dbReady) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      return;
    }
    const auth = await personFromCookies(req);
    if (!auth.person) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      void setupSocket(ws, auth.person!);
    });
  } catch {
    try {
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    } catch {
      // socket already gone
    }
  }
});

async function setupSocket(ws: WebSocket, person: service.PersonRow): Promise<void> {
  const handle: sockets.SocketHandle = {
    send: (frame) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
    },
    personId: person.person_id,
    joinedDocId: null,
    ws,
    doc: null,
  };
  sockets.registerSocket(person.person_id, handle);
  ws.on('message', (data) => {
    const raw = data.toString('utf-8');
    if (raw.length > 65_536) {
      handle.send({ type: 'error', ref: '', code: 'too_large' });
      return;
    }
    let frame: sockets.ClientFrame;
    try {
      frame = JSON.parse(raw) as sockets.ClientFrame;
    } catch {
      handle.send({ type: 'error', ref: '', code: 'invalid' });
      return;
    }
    void sockets.handleFrame({ pool, person, handle }, frame).catch(() => {
      handle.send({ type: 'error', ref: frame.ref, code: 'invalid' });
    });
  });
  ws.on('close', () => {
    sockets.unregisterSocket(handle);
  });
}

void connectDb();

server.listen(config.port, '0.0.0.0', () => {
  console.log(`Quillmere Drafts serving on port ${config.port}`);
});
