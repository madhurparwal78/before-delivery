// The Scopewright server: HTML pages, the API under /api, and health.

import express, { type Request, type Response, type NextFunction } from 'express';
import net from 'node:net';
import type { PoolClient } from 'pg';
import {
  AppTimers, IMPORT_FILE_LIMIT, IMPORT_REQUEST_LIMIT, JSON_BODY_LIMIT, readTimers,
} from '../shared/constants.js';
import { PageDocument, Derived } from '../shared/types.js';
import { derivePage } from '../shared/geometry.js';
import { danglingConnectors, validatePage, validPlainText } from '../shared/model.js';
import { ApiError, errors } from './errors.js';
import {
  baseSecurityHeaders, clearSessionCookie, cspForHtml, header, newNonce, originRulePassed,
  sessionCookieHeader, SESSION_COOKIE, sha256, newToken, contentDisposition,
} from './security.js';
import { applySchemaAndSeed, pool, withClient, withTransaction } from './db.js';
import {
  attemptSignIn, checkLockout, createSession, endAllSessions, findPersonByEmail,
  loadSession, Person, recordFailure, SessionInfo, writeAccountEvent,
} from './auth.js';
import { hashPassword, verifyPassword } from './passwords.js';
import {
  diagramRole, requireDiagramAccess, requirePage, requireRole, DiagramAccess,
} from './roles.js';
import {
  acceptShare, changeShareRole, checkLookupLimit, effectiveStatus, findShareByToken,
  getShare, inviteShare, recordFailedLookup, removeShare, ShareRow, ShareContext, writeDiagramEvent,
} from './shares.js';
import { deliverQueued } from './mail.js';
import { importToPage, importFileName } from './imports.js';
import { createExport, ExportPageInput, exportFileName } from './exports.js';
import {
  getObject, importModelKey, importOriginalKey, putObject, sha256Hex, storageUp,
} from './storage.js';

const timers: AppTimers = readTimers(process.env as Record<string, string | undefined>);
const PORT = Number(process.env.APP_PUBLIC_PORT ?? 4173);

const app = express();
app.disable('x-powered-by');

// No Access-Control header is ever set, including on OPTIONS preflights.
app.use((req, res, next) => {
  for (const [key, value] of Object.entries(baseSecurityHeaders())) {
    res.setHeader(key, value);
  }
  res.removeHeader('Access-Control-Allow-Origin');
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});

// ---------------------------------------------------------------------------
// Request context: client IP, session, timers.

interface ReqState {
  ip: string;
  session: SessionInfo | null;
  sessionExpired: boolean;
  ctxNow: Date;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      state?: ReqState;
    }
  }
}

function clientIp(req: Request): string {
  return req.socket.remoteAddress ?? '0.0.0.0';
}

function readSessionCookie(req: Request): string | undefined {
  const cookies = header(req.headers, 'cookie');
  if (cookies === undefined) return undefined;
  for (const part of cookies.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return rest.join('=');
  }
  return undefined;
}

// Every request loads its session and resets the idle clock. GET /api/status
// does not touch the idle clock, so its route reads the session without
// loading it through this middleware when it must not count.
app.use(async (req, _res, next) => {
  // The health and status endpoints do not touch the idle clock.
  if (req.path === '/api/health' || req.path === '/api/status') {
    req.state = { ip: clientIp(req), session: null, sessionExpired: false, ctxNow: new Date() };
    next();
    return;
  }
  const now = new Date();
  const cookie = readSessionCookie(req);
  try {
    const result = await withClient(async (client) => {
      const loaded = await loadSession({ client, ip: clientIp(req), timers, now }, cookie);
      return loaded;
    });
    req.state = {
      ip: clientIp(req),
      session: result && !result.expired ? result.session : null,
      sessionExpired: result !== null && result.expired,
      ctxNow: now,
    };
    next();
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Error shape and response helpers.

function sendError(res: Response, err: ApiError): void {
  const body = err.body();
  if (err.headers) {
    for (const [k, v] of Object.entries(err.headers)) {
      res.setHeader(k, v);
    }
  }
  res.status(err.status).json(body);
}

function sendJson(res: Response, status: number, body: unknown, headers?: Record<string, string>): void {
  if (headers) {
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  }
  res.status(status).json(body);
}

// Origin rule + body limits + content type + session + CSRF, in the published
// precedence order: cross-site, oversized body, wrong content type, session,
// CSRF. Returns the parsed body, or null after answering an error.
async function beginJson(
  req: Request,
  res: Response,
  options: { session: 'required' | 'none'; csrf: boolean },
): Promise<{ state: ReqState; body: unknown } | null> {
  if (!originRulePassed(req)) {
    sendError(res, errors.crossSite());
    return null;
  }
  const raw = await readRawBody(req, JSON_BODY_LIMIT);
  if (raw === null) {
    sendError(res, errors.payloadTooLarge());
    return null;
  }
  const contentType = header(req.headers, 'content-type') ?? '';
  if (!contentType.startsWith('application/json')) {
    sendError(res, errors.unsupportedMediaType());
    return null;
  }
  const state = req.state;
  if (state === undefined) {
    sendError(res, errors.internal());
    return null;
  }
  if (options.session === 'required' && state.session === null) {
    if (state.sessionExpired) {
      sendError(res, errors.sessionExpired());
    } else {
      sendError(res, errors.unauthenticated());
    }
    return null;
  }
  if (options.csrf && state.session !== null) {
    const token = header(req.headers, 'x-csrf-token');
    if (token !== state.session.csrfToken) {
      sendError(res, errors.csrfInvalid());
      return null;
    }
  }
  let body: unknown = {};
  if (raw.length > 0) {
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      sendError(res, errors.validation({ body: 'invalid' }));
      return null;
    }
  }
  return { state, body };
}

// The Origin-rule and session guard for routes that do not read a JSON body.
async function guard(
  req: Request,
  res: Response,
  options: { session: 'required' | 'none'; csrf: boolean },
): Promise<ReqState | null> {
  if (!originRulePassed(req)) {
    sendError(res, errors.crossSite());
    return null;
  }
  const state = req.state;
  if (state === undefined) {
    sendError(res, errors.internal());
    return null;
  }
  if (options.session === 'required') {
    if (state.session === null) {
      if (state.sessionExpired) {
        sendError(res, errors.sessionExpired());
      } else {
        sendError(res, errors.unauthenticated());
      }
      return null;
    }
    if (options.csrf) {
      const token = header(req.headers, 'x-csrf-token');
      if (token !== state.session.csrfToken) {
        sendError(res, errors.csrfInvalid());
        return null;
      }
    }
  }
  return state;
}

function readRawBody(req: Request, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        over = true;
        resolve(null);
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (over) return;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

// Express 4 does not forward rejected promises from handlers, so every async
// handler is wrapped here.
type Handler = (req: Request, res: Response) => Promise<void>;
function asyncHandler(fn: Handler) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((err: unknown) => {
      if (res.headersSent) return;
      if (err instanceof ApiError) {
        sendError(res, err);
        return;
      }
      console.error('unexpected error:', err instanceof Error ? err.message : 'unknown');
      sendError(res, errors.internal());
    });
  };
}

// ---------------------------------------------------------------------------
// Health and status.

app.get('/api/health', (_req, res) => {
  if (dbReady) {
    sendJson(res, 200, { status: 'ok' });
  } else {
    res.status(503).json({ status: 'starting' });
  }
});

app.get('/api/status', asyncHandler(async (_req, res) => {
  const [storage, mail] = await Promise.all([
    storageUp().catch(() => false),
    mailUp().catch(() => false),
  ]);
  sendJson(res, 200, { storage: storage ? 'up' : 'down', mail: mail ? 'up' : 'down' });
}));

async function mailUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: process.env.SMTP_HOST ?? 'mailpit', port: Number(process.env.SMTP_PORT ?? 1025) });
    socket.setTimeout(2000);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => { socket.destroy(); resolve(false); });
  });
}

// ---------------------------------------------------------------------------
// Auth.

function sessionBody(session: SessionInfo): { user: { id: string; email: string; displayName: string }; csrfToken: string } {
  return {
    user: { id: session.person.id, email: session.person.email, displayName: session.person.displayName },
    csrfToken: session.csrfToken,
  };
}

app.get('/api/session', asyncHandler(async (req, res) => {
  const state = req.state;
  if (state === undefined || state.session === null) {
    if (state !== undefined && state.sessionExpired) {
      sendError(res, errors.sessionExpired());
      return;
    }
    sendError(res, errors.unauthenticated());
    return;
  }
  sendJson(res, 200, sessionBody(state.session));
}));

// Sign-in. There are two requests without a session needing the Origin rule:
// this one, and invitation acceptance by a new account.
app.post('/api/session', asyncHandler(async (req, res) => {
  const request = await beginJson(req, res, { session: 'none', csrf: false });
  if (request === null) return;
  const { state, body } = request;
  const { email, password } = body as { email?: unknown; password?: unknown };
  const fields: Record<string, string> = {};
  if (typeof email !== 'string' || email.trim() === '') fields.email = 'required';
  if (typeof password !== 'string' || password === '') fields.password = 'required';
  if (Object.keys(fields).length > 0) {
    sendError(res, errors.validation(fields));
    return;
  }
  const emailStr = email as string;
  const passwordStr = password as string;
  try {
    const attempt = await withTransaction(async (client) => {
      const ctx = { client, ip: state.ip, timers, now: new Date() };
      return attemptSignIn(ctx, emailStr, passwordStr);
    });
    if (!attempt.ok) {
      // The failure is already committed with its audit events.
      sendError(res, errors.invalidCredentials());
      return;
    }
    const person = attempt.person;
    const session = await withTransaction(async (client) => {
      const ctx = { client, ip: state.ip, timers, now: new Date() };
      const existingHash = readSessionCookie(req) ? sha256(readSessionCookie(req) as string) : null;
      return createSession(ctx, person.id, existingHash);
    });
    res.setHeader('Set-Cookie', sessionCookieHeader(session.sessionId));
    sendJson(res, 200, sessionBody(session));
  } catch (err) {
    if (err instanceof ApiError) {
      sendError(res, err);
      return;
    }
    throw err;
  }
}));

app.delete('/api/session', asyncHandler(async (req, res) => {
  const state = await guard(req, res, { session: 'required', csrf: true });
  if (state === null) return;
  await withTransaction(async (client) => {
    await endAllSessions(client, state.session?.person.id as string);
  });
  res.setHeader('Set-Cookie', clearSessionCookie());
  res.status(204).end();
}));

app.post('/api/session/password', asyncHandler(async (req, res) => {
  const request = await beginJson(req, res, { session: 'required', csrf: true });
  if (request === null) return;
  const { state, body } = request;
  const { currentPassword, newPassword } = body as { currentPassword?: unknown; newPassword?: unknown };
  const person = state.session?.person as Person;
  try {
    const result = await withTransaction(async (client) => {
      const ctx = { client, ip: state.ip, timers, now: new Date() };
      // A lockout is checked before the current password, as at sign-in.
      await checkLockout(ctx, person.email);
      const row = await findPersonByEmail(client, person.email);
      if (row === null || !(await verifyPassword(row.passwordHash, currentPassword as string))) {
        const locked = await recordFailure(ctx, person.email);
        await writeAccountEvent({ client, now: new Date() }, person.id, person.email, 'signin.failed', { ip: state.ip });
        if (locked) {
          await writeAccountEvent({ client, now: new Date() }, person.id, person.email, 'signin.locked', { ip: state.ip });
        }
        return null;
      }
      if (typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 128) {
        throw errors.validation({ newPassword: 'length' });
      }
      if (newPassword === currentPassword) {
        throw errors.validation({ newPassword: 'unchanged' });
      }
      const hash = await hashPassword(newPassword);
      await client.query('UPDATE people SET password_hash = $1 WHERE id = $2', [hash, person.id]);
      // Every session of that person ends; the tab that changed it gets a
      // fresh session.
      await endAllSessions(client, person.id);
      const existingHash = readSessionCookie(req) ? sha256(readSessionCookie(req) as string) : null;
      const session = await createSession(ctx, person.id, existingHash);
      await writeAccountEvent({ client, now: new Date() }, person.id, person.email, 'password.changed', {});
      return session;
    });
    if (result === null) {
      // The wrong current password: the failure is committed with its audit
      // events, and the field error answers.
      sendError(res, errors.validation({ currentPassword: 'incorrect' }));
      return;
    }
    res.setHeader('Set-Cookie', sessionCookieHeader(result.sessionId));
    sendJson(res, 200, sessionBody(result));
  } catch (err) {
    if (err instanceof ApiError) {
      sendError(res, err);
      return;
    }
    throw err;
  }
}));

// ---------------------------------------------------------------------------
// Diagrams.

interface DiagramRow {
  id: string;
  title: string;
  role: string;
  updated_at: Date;
  owner_id: string;
}

async function listDiagramsFor(personId: string): Promise<{ id: string; title: string; role: string; updatedAt: string }[]> {
  return withClient(async (client) => {
    const rows = await client.query<DiagramRow>(
      `SELECT d.id, d.title, d.updated_at,
         CASE WHEN d.owner_id = $1 THEN 'owner' ELSE sh.role END AS role
       FROM diagrams d
       LEFT JOIN shares sh ON sh.diagram_id = d.id AND lower(sh.email) = (SELECT email FROM people WHERE id = $1) AND sh.status = 'active'
       WHERE d.owner_id = $1 OR sh.id IS NOT NULL
       ORDER BY d.updated_at DESC`,
      [personId],
    );
    return rows.rows.map((row) => ({
      id: row.id,
      title: row.title,
      role: row.role,
      updatedAt: row.updated_at.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    }));
  });
}

app.get('/api/diagrams', asyncHandler(async (req, res) => {
  const state = await guard(req, res, { session: 'required', csrf: false });
  if (state === null) return;
  const diagrams = await listDiagramsFor(state.session?.person.id as string);
  sendJson(res, 200, { diagrams });
}));

app.post('/api/diagrams', asyncHandler(async (req, res) => {
  const request = await beginJson(req, res, { session: 'required', csrf: true });
  if (request === null) return;
  const { state, body } = request;
  const { title } = body as { title?: unknown };
  if (typeof title !== 'string' || !validPlainText(title, 120)) {
    sendError(res, errors.validation({ title: 'invalid' }));
    return;
  }
  const person = state.session?.person as Person;
  const diagramId = crypto.randomUUID();
  const pageId = crypto.randomUUID();
  const doc: PageDocument = {
    id: pageId,
    name: 'Page 1',
    version: 1,
    zones: [],
    shapes: [],
    connectors: [],
  };
  const derived = derivePage(doc);
  const created = await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO diagrams (id, owner_id, title) VALUES ($1, $2, $3)`,
      [diagramId, person.id, title.trim()],
    );
    await client.query(
      `INSERT INTO pages (id, diagram_id, name, version, doc, derived, position)
       VALUES ($1, $2, $3, 1, $4, $5, 1)`,
      [pageId, diagramId, doc.name, JSON.stringify(doc), JSON.stringify(derived)],
    );
    const ownerName = await client.query<{ display_name: string }>(
      'SELECT display_name FROM people WHERE id = $1', [person.id],
    );
    return { updatedAt: new Date(), ownerName: ownerName.rows[0].display_name };
  });
  sendJson(res, 201, {
    diagram: {
      id: diagramId,
      title: title.trim(),
      role: 'owner',
      ownerName: created.ownerName,
      pages: [{ id: pageId, name: 'Page 1', version: 1 }],
      updatedAt: created.updatedAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    },
  });
}));

async function requireDiagram(client: PoolClient, state: ReqState, diagramId: string): Promise<DiagramAccess> {
  return requireDiagramAccess(client, state.session?.person.id ?? null, diagramId);
}

app.get('/api/diagrams/:diagramId', asyncHandler(async (req, res) => {
  const state = await guard(req, res, { session: 'required', csrf: false });
  if (state === null) return;
  const diagramId = req.params.diagramId;
  const result = await withClient(async (client) => {
    const access = await requireDiagram(client, state, diagramId);
    const pages = await client.query<{ id: string; name: string; version: number }>(
      `SELECT id, name, version FROM pages WHERE diagram_id = $1 ORDER BY position ASC`,
      [diagramId],
    );
    const owner = await client.query<{ display_name: string; updated_at: Date }>(
      `SELECT p.display_name, d.updated_at FROM diagrams d JOIN people p ON p.id = d.owner_id WHERE d.id = $1`,
      [diagramId],
    );
    return { access, pages: pages.rows, ownerName: owner.rows[0].display_name, updatedAt: owner.rows[0].updated_at };
  });
  sendJson(res, 200, {
    diagram: {
      id: diagramId,
      title: result.access.title,
      role: result.access.role,
      ownerName: result.ownerName,
      pages: result.pages,
      updatedAt: result.updatedAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    },
  });
}));

app.patch('/api/diagrams/:diagramId', asyncHandler(async (req, res) => {
  const request = await beginJson(req, res, { session: 'required', csrf: true });
  if (request === null) return;
  const { state, body } = request;
  const diagramId = req.params.diagramId;
  const { title } = body as { title?: unknown };
  if (typeof title !== 'string' || !validPlainText(title, 120)) {
    sendError(res, errors.validation({ title: 'invalid' }));
    return;
  }
  const result = await withTransaction(async (client) => {
    const access = await requireDiagram(client, state, diagramId);
    await requireRole(access, 'editor');
    await client.query(
      `UPDATE diagrams SET title = $1, updated_at = now() WHERE id = $2`,
      [title.trim(), diagramId],
    );
    const pages = await client.query<{ id: string; name: string; version: number }>(
      `SELECT id, name, version FROM pages WHERE diagram_id = $1 ORDER BY position ASC`,
      [diagramId],
    );
    const owner = await client.query<{ display_name: string }>(
      `SELECT p.display_name FROM diagrams d JOIN people p ON p.id = d.owner_id WHERE d.id = $1`,
      [diagramId],
    );
    return { access, pages: pages.rows, ownerName: owner.rows[0].display_name };
  });
  sendJson(res, 200, {
    diagram: {
      id: diagramId,
      title: result.access.title,
      role: result.access.role,
      ownerName: result.ownerName,
      pages: result.pages,
      updatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    },
  });
}));

// Deleting a diagram removes everything in one step.
app.delete('/api/diagrams/:diagramId', asyncHandler(async (req, res) => {
  const state = await guard(req, res, { session: 'required', csrf: true });
  if (state === null) return;
  const diagramId = req.params.diagramId;
  await withTransaction(async (client) => {
    const access = await requireDiagram(client, state, diagramId);
    await requireRole(access, 'owner');
    // Withdraw pending invitations so their tokens die.
    await client.query(
      `UPDATE shares SET status = 'withdrawn', token_hash = NULL WHERE diagram_id = $1 AND status IN ('invited', 'expired')`,
      [diagramId],
    );
    // Cancel every queued message for the diagram.
    await client.query(
      `UPDATE mail_queue SET status = 'cancelled' WHERE diagram_id = $1 AND status IN ('queued', 'sending')`,
      [diagramId],
    );
    // Downloads, imports and exports answer not-found once the diagram is gone.
    await client.query('DELETE FROM downloads WHERE diagram_id = $1', [diagramId]);
    await client.query('DELETE FROM imports WHERE diagram_id = $1', [diagramId]);
    await client.query('DELETE FROM exports WHERE diagram_id = $1', [diagramId]);
    await client.query('DELETE FROM idempotency_keys WHERE diagram_id = $1', [diagramId]);
    await client.query('DELETE FROM audit_events WHERE diagram_id = $1', [diagramId]);
    await client.query('DELETE FROM shares WHERE diagram_id = $1', [diagramId]);
    await client.query('DELETE FROM pages WHERE diagram_id = $1', [diagramId]);
    await client.query('DELETE FROM diagrams WHERE id = $1', [diagramId]);
  });
  res.status(204).end();
}));

app.get('/api/diagrams/:diagramId/audit', asyncHandler(async (req, res) => {
  const state = await guard(req, res, { session: 'required', csrf: false });
  if (state === null) return;
  const diagramId = req.params.diagramId;
  const events = await withClient(async (client) => {
    const access = await requireDiagram(client, state, diagramId);
    await requireRole(access, 'owner');
    const rows = await client.query<{ at: Date; actor: string; action: string; detail: unknown }>(
      `SELECT at, actor, action, detail FROM audit_events WHERE diagram_id = $1 ORDER BY id DESC LIMIT 500`,
      [diagramId],
    );
    return rows.rows.map((row) => ({
      id: `${row.at.getTime()}-${row.action}`,
      at: row.at.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      actor: row.actor,
      action: row.action,
      detail: row.detail,
    }));
  });
  sendJson(res, 200, { events });
}));

// Any method other than GET on the audit paths answers 405.
app.all('/api/diagrams/:diagramId/audit', (_req, res) => {
  res.setHeader('Allow', 'GET');
  res.status(405).json({ error: 'method_not_allowed', message: 'This method is not allowed.' });
});
// The caller's own account events, newest first, at most 500.
app.get('/api/account/audit', asyncHandler(async (req, res) => {
  const state = await guard(req, res, { session: 'required', csrf: false });
  if (state === null) return;
  const events = await withClient(async (client) => {
    const rows = await client.query<{ at: Date; actor: string; action: string; detail: unknown }>(
      `SELECT at, actor, action, detail FROM audit_events
       WHERE person_id = $1 ORDER BY id DESC LIMIT 500`,
      [state.session?.person.id],
    );
    return rows.rows.map((row) => ({
      id: `${row.at.getTime()}-${row.action}`,
      at: row.at.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      actor: row.actor,
      action: row.action,
      detail: row.detail,
    }));
  });
  sendJson(res, 200, { events });
}));

app.all('/api/account/audit', (_req, res) => {
  res.setHeader('Allow', 'GET');
  res.status(405).json({ error: 'method_not_allowed', message: 'This method is not allowed.' });
});

// ---------------------------------------------------------------------------
// Pages and items.

const MAX_PAGES = 20;

app.post('/api/diagrams/:diagramId/pages', asyncHandler(async (req, res) => {
  const request = await beginJson(req, res, { session: 'required', csrf: true });
  if (request === null) return;
  const { state, body } = request;
  const diagramId = req.params.diagramId;
  const { name } = body as { name?: unknown };
  if (typeof name !== 'string' || !validPlainText(name, 80)) {
    sendError(res, errors.validation({ name: 'invalid' }));
    return;
  }
  const pageId = crypto.randomUUID();
  const result = await withTransaction(async (client) => {
    const access = await requireDiagram(client, state, diagramId);
    await requireRole(access, 'editor');
    const count = await client.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM pages WHERE diagram_id = $1',
      [diagramId],
    );
    if (Number(count.rows[0].n) >= MAX_PAGES) throw errors.pageLimit();
    const doc: PageDocument = { id: pageId, name: name.trim(), version: 1, zones: [], shapes: [], connectors: [] };
    const derived = derivePage(doc);
    await client.query(
      `INSERT INTO pages (id, diagram_id, name, version, doc, derived, position)
       VALUES ($1, $2, $3, 1, $4, $5, (SELECT COALESCE(MAX(position), 0) + 1 FROM pages WHERE diagram_id = $2))`,
      [pageId, diagramId, name.trim(), JSON.stringify(doc), JSON.stringify(derived)],
    );
    await client.query('UPDATE diagrams SET updated_at = now() WHERE id = $1', [diagramId]);
    return { name: name.trim() };
  });
  sendJson(res, 201, { page: { id: pageId, name: result.name, version: 1 } });
}));

app.get('/api/diagrams/:diagramId/pages/:pageId', asyncHandler(async (req, res) => {
  const state = await guard(req, res, { session: 'required', csrf: false });
  if (state === null) return;
  const { diagramId, pageId } = req.params;
  const result = await withClient(async (client) => {
    await requireDiagram(client, state, diagramId);
    return requirePage(client, diagramId, pageId);
  });
  sendJson(res, 200, { page: result.doc, derived: result.derived });
}));

// A page saves as one document guarded by its version number.
app.put('/api/diagrams/:diagramId/pages/:pageId', asyncHandler(async (req, res) => {
  const request = await beginJson(req, res, { session: 'required', csrf: true });
  if (request === null) return;
  const { state, body } = request;
  const { diagramId, pageId } = req.params;
  const doc = body as PageDocument;
  if (doc === null || typeof doc !== 'object' || typeof doc.id !== 'string' || doc.id !== pageId) {
    sendError(res, errors.notFound());
    return;
  }
  const result = await withTransaction(async (client) => {
    const access = await requireDiagram(client, state, diagramId);
    await requireRole(access, 'editor');
    const page = await requirePage(client, diagramId, pageId);
    if (doc.version !== page.version) {
      throw errors.versionConflict();
    }
    const fieldErrors = validatePage(doc);
    if (fieldErrors !== null) {
      throw errors.validation(fieldErrors);
    }
    const dangling = danglingConnectors(doc);
    if (dangling !== null) {
      const fields: Record<string, string> = {};
      for (const id of dangling) fields[`connectors.${id}`] = 'dangling';
      throw errors.danglingConnector(fields);
    }
    const derived = derivePage(doc);
    const newDoc = { ...doc, version: page.version + 1 };
    const updated = await client.query<{ version: number }>(
      `UPDATE pages SET doc = $1, derived = $2, version = version + 1, name = $3
       WHERE id = $4 AND version = $5 RETURNING version`,
      [JSON.stringify(newDoc), JSON.stringify(derived), doc.name, pageId, page.version],
    );
    if (updated.rowCount === 0) throw errors.versionConflict();
    await client.query('UPDATE diagrams SET updated_at = now() WHERE id = $1', [diagramId]);
    return { doc: newDoc, derived };
  });
  sendJson(res, 200, { page: result.doc, derived: result.derived });
}));

// Item reads: every nested id is checked against its parent diagram and page.
app.get('/api/diagrams/:diagramId/pages/:pageId/shapes/:shapeId', asyncHandler(async (req, res) => {
  const state = await guard(req, res, { session: 'required', csrf: false });
  if (state === null) return;
  const { diagramId, pageId, shapeId } = req.params;
  const result = await withClient(async (client) => {
    await requireDiagram(client, state, diagramId);
    const page = await requirePage(client, diagramId, pageId);
    const doc = page.doc as PageDocument;
    const shape = doc.shapes.find((s) => s.id === shapeId);
    if (shape === undefined) throw errors.notFound();
    const zoneIds = doc.zones.filter((z) => zoneContainsId(z, shape)).map((z) => z.id);
    return { shape, zoneIds };
  });
  sendJson(res, 200, { shape: result.shape, zoneIds: result.zoneIds });
}));

function zoneContainsId(zone: { x: number; y: number; width: number; height: number }, shape: { x: number; y: number; width: number; height: number }): boolean {
  const cx = shape.x + shape.width / 2;
  const cy = shape.y + shape.height / 2;
  return cx >= zone.x && cx <= zone.x + zone.width && cy >= zone.y && cy <= zone.y + zone.height;
}

app.get('/api/diagrams/:diagramId/pages/:pageId/zones/:zoneId', asyncHandler(async (req, res) => {
  const state = await guard(req, res, { session: 'required', csrf: false });
  if (state === null) return;
  const { diagramId, pageId, zoneId } = req.params;
  const result = await withClient(async (client) => {
    await requireDiagram(client, state, diagramId);
    const page = await requirePage(client, diagramId, pageId);
    const doc = page.doc as PageDocument;
    const zone = doc.zones.find((z) => z.id === zoneId);
    if (zone === undefined) throw errors.notFound();
    const derived = page.derived as Derived;
    const zoneDerived = derived.zones.find((z) => z.id === zoneId);
    if (zoneDerived === undefined) throw errors.notFound();
    const crossingPoints = derived.crossings
      .filter((c) => c.zoneId === zoneId)
      .map((c) => ({ connectorId: c.connectorId, x: c.x, y: c.y, direction: c.direction }));
    return {
      zone,
      derived: {
        systems: zoneDerived.systems,
        crossings: zoneDerived.crossings,
        members: zoneDerived.members,
        crossingPoints,
      },
    };
  });
  sendJson(res, 200, { zone: result.zone, derived: result.derived });
}));

app.get('/api/diagrams/:diagramId/pages/:pageId/connectors/:connectorId', asyncHandler(async (req, res) => {
  const state = await guard(req, res, { session: 'required', csrf: false });
  if (state === null) return;
  const { diagramId, pageId, connectorId } = req.params;
  const result = await withClient(async (client) => {
    await requireDiagram(client, state, diagramId);
    const page = await requirePage(client, diagramId, pageId);
    const doc = page.doc as PageDocument;
    const connector = doc.connectors.find((c) => c.id === connectorId);
    if (connector === undefined) throw errors.notFound();
    const derived = page.derived as Derived;
    const crossings = derived.crossings
      .filter((c) => c.connectorId === connectorId)
      .map((c) => ({ zoneId: c.zoneId, x: c.x, y: c.y, direction: c.direction }));
    return { connector, crossings };
  });
  sendJson(res, 200, { connector: result.connector, crossings: result.crossings });
}));

// ---------------------------------------------------------------------------
// Shares. Listing and changing needs the owner.

function shareJson(share: ShareRow, now: Date): unknown {
  const status = effectiveStatus(share, now);
  return {
    id: share.id,
    email: share.email,
    displayName: share.display_name,
    role: share.role,
    status,
    expiresAt: status === 'invited' || status === 'expired'
      ? (share.expires_at as Date).toISOString().replace(/\.\d{3}Z$/, 'Z')
      : null,
  };
}

async function shareDeliveryState(client: PoolClient, share: ShareRow): Promise<'sent' | 'queued'> {
  const rows = await client.query<{ status: string }>(
    `SELECT status FROM mail_queue WHERE diagram_id = $1 AND to_email = $2 AND status IN ('sent', 'queued', 'sending')
     ORDER BY created_at DESC LIMIT 1`,
    [share.diagram_id, share.email],
  );
  if (rows.rowCount === 0) return 'queued';
  return rows.rows[0].status === 'sent' ? 'sent' : 'queued';
}

app.get('/api/diagrams/:diagramId/shares', asyncHandler(async (req, res) => {
  const state = await guard(req, res, { session: 'required', csrf: false });
  if (state === null) return;
  const diagramId = req.params.diagramId;
  const now = new Date();
  const shares = await withClient(async (client) => {
    const access = await requireDiagram(client, state, diagramId);
    await requireRole(access, 'owner');
    const rows = await client.query<ShareRow>(
      `SELECT id, diagram_id, email, display_name, role, status, token_hash, expires_at, created_at, used_at
       FROM shares
       WHERE diagram_id = $1 AND status IN ('invited', 'expired', 'active')
       ORDER BY created_at ASC`,
      [diagramId],
    );
    const out = [];
    for (const share of rows.rows) {
      if (effectiveStatus(share, now) === 'revoked' || effectiveStatus(share, now) === 'withdrawn') continue;
      const json = shareJson(share, now) as { delivery?: string };
      if (effectiveStatus(share, now) === 'invited') {
        json.delivery = await shareDeliveryState(client, share);
      }
      out.push(json);
    }
    return out;
  });
  sendJson(res, 200, { shares });
}));

app.post('/api/diagrams/:diagramId/shares', asyncHandler(async (req, res) => {
  const request = await beginJson(req, res, { session: 'required', csrf: true });
  if (request === null) return;
  const { state, body } = request;
  const diagramId = req.params.diagramId;
  const { email, role } = body as { email?: unknown; role?: unknown };
  const fields: Record<string, string> = {};
  if (typeof email !== 'string' || !validEmail(email)) fields.email = 'invalid';
  if (role !== 'editor' && role !== 'viewer') fields.role = 'invalid';
  if (Object.keys(fields).length > 0) {
    sendError(res, errors.validation(fields));
    return;
  }
  const person = state.session?.person as Person;
  try {
    const share = await withTransaction(async (client) => {
      const access = await requireDiagram(client, state, diagramId);
      await requireRole(access, 'owner');
      const ctx: ShareContext = {
        client,
        now: new Date(),
        timers,
        actor: person.email,
      };
      const ownerEmail = await client.query<{ email: string }>(
        'SELECT email FROM people WHERE id = $1', [access.ownerId],
      );
      const result = await inviteShare(ctx, diagramId, access.title, person.displayName, ownerEmail.rows[0].email, email as string, role as 'editor' | 'viewer');
      const delivery = await shareDeliveryState(client, result.share);
      return { share: result.share, delivery };
    });
    // Attempt delivery at once, outside the transaction.
    void deliverQueued();
    const json = shareJson(share.share, new Date()) as { delivery?: string };
    json.delivery = share.delivery;
    sendJson(res, 201, { share: json });
  } catch (err) {
    if (err instanceof ApiError) {
      sendError(res, err);
      return;
    }
    throw err;
  }
}));

function validEmail(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 254) return false;
  if (/[\s\u0000-\u001F\u007F]/.test(trimmed)) return false;
  const at = trimmed.indexOf('@');
  if (at <= 0 || at !== trimmed.lastIndexOf('@')) return false;
  return true;
}

app.patch('/api/diagrams/:diagramId/shares/:shareId', asyncHandler(async (req, res) => {
  const request = await beginJson(req, res, { session: 'required', csrf: true });
  if (request === null) return;
  const { state, body } = request;
  const { diagramId, shareId } = req.params;
  const { role } = body as { role?: unknown };
  if (role !== 'editor' && role !== 'viewer') {
    sendError(res, errors.validation({ role: 'invalid' }));
    return;
  }
  const person = state.session?.person as Person;
  try {
    const share = await withTransaction(async (client) => {
      const access = await requireDiagram(client, state, diagramId);
      await requireRole(access, 'owner');
      const share = await getShare(client, diagramId, shareId);
      if (share === null) throw errors.notFound();
      const ctx: ShareContext = { client, now: new Date(), timers, actor: person.email };
      await changeShareRole(ctx, share, role as 'editor' | 'viewer', access.title);
      return { ...share, role: role as 'editor' | 'viewer' };
    });
    void deliverQueued();
    sendJson(res, 200, { share: shareJson(share, new Date()) });
  } catch (err) {
    if (err instanceof ApiError) {
      sendError(res, err);
      return;
    }
    throw err;
  }
}));

app.delete('/api/diagrams/:diagramId/shares/:shareId', asyncHandler(async (req, res) => {
  const state = await guard(req, res, { session: 'required', csrf: true });
  if (state === null) return;
  const { diagramId, shareId } = req.params;
  const person = state.session?.person as Person;
  try {
    await withTransaction(async (client) => {
      const access = await requireDiagram(client, state, diagramId);
      await requireRole(access, 'owner');
      const share = await getShare(client, diagramId, shareId);
      if (share === null) throw errors.notFound();
      const ctx: ShareContext = { client, now: new Date(), timers, actor: person.email };
      await removeShare(ctx, share, access.title);
    });
    void deliverQueued();
    res.status(204).end();
  } catch (err) {
    if (err instanceof ApiError) {
      sendError(res, err);
      return;
    }
    throw err;
  }
}));

// ---------------------------------------------------------------------------
// Invitations. Open to signed-in and signed-out visitors.

app.get('/api/invites/:token', asyncHandler(async (req, res) => {
  res.setHeader('Referrer-Policy', 'no-referrer');
  const token = req.params.token;
  const now = new Date();
  try {
    const result = await withClient(async (client) => {
      // The failed-lookup limit is checked before the token is looked up.
      await checkLookupLimit({ client, now, timers }, req.state?.ip ?? clientIp(req));
      const share = await findShareByToken(client, token);
      if (share === null || share.status !== 'invited') {
        await recordFailedLookup({ client, now, timers }, req.state?.ip ?? clientIp(req));
        throw errors.inviteUsed();
      }
      if (effectiveStatus(share, now) === 'expired') {
        await recordFailedLookup({ client, now, timers }, req.state?.ip ?? clientIp(req));
        throw errors.inviteExpired();
      }
      const diagram = await client.query<{ title: string; owner_id: string }>(
        'SELECT title, owner_id FROM diagrams WHERE id = $1',
        [share.diagram_id],
      );
      const inviter = await client.query<{ display_name: string }>(
        'SELECT display_name FROM people WHERE id = $1',
        [diagram.rows[0].owner_id],
      );
      const accountExists = await client.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM people WHERE lower(email) = lower($1)',
        [share.email],
      );
      return {
        invite: {
          diagramTitle: diagram.rows[0].title,
          inviterName: inviter.rows[0].display_name,
          role: share.role,
          email: share.email,
          accountExists: accountExists.rows[0].n !== '0',
        },
      };
    });
    sendJson(res, 200, result);
  } catch (err) {
    if (err instanceof ApiError) {
      sendError(res, err);
      return;
    }
    throw err;
  }
}));

app.post('/api/invites/:token/accept', asyncHandler(async (req, res) => {
  res.setHeader('Referrer-Policy', 'no-referrer');
  const token = req.params.token;
  const request = await beginJson(req, res, { session: 'none', csrf: false });
  if (request === null) return;
  const { state, body } = request;
  const now = new Date();
  const ip = state.ip;
  try {
    const result = await withTransaction(async (client) => {
      await checkLookupLimit({ client, now, timers }, ip);
      const share = await findShareByToken(client, token);
      if (share === null || share.status !== 'invited') {
        await recordFailedLookup({ client, now, timers }, ip);
        throw errors.inviteUsed();
      }
      if (effectiveStatus(share, now) === 'expired') {
        await recordFailedLookup({ client, now, timers }, ip);
        throw errors.inviteExpired();
      }
      const existing = await findPersonByEmail(client, share.email);
      if (state.session !== null) {
        // Signed in: the invitation grants only to its addressee.
        if (state.session.person.email.toLowerCase() !== share.email.toLowerCase()) {
          throw errors.inviteEmailMismatch();
        }
        const ctx: ShareContext = { client, now, timers, actor: state.session.person.email };
        await acceptShare(ctx, share, share.email);
        const firstPage = await firstPageOf(client, share.diagram_id);
        return { diagramId: share.diagram_id, firstPageId: firstPage, role: share.role, session: null };
      }
      if (existing !== null) {
        // Signed out but the email already has an account.
        throw errors.unauthenticated();
      }
      const { displayName, password } = body as { displayName?: unknown; password?: unknown };
      if (typeof displayName !== 'string' || !validPlainText(displayName, 80)) {
        throw errors.validation({ displayName: 'invalid' });
      }
      if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
        throw errors.validation({ password: 'invalid' });
      }
      const hash = await hashPassword(password);
      const personId = `per-${crypto.randomUUID()}`;
      await client.query(
        `INSERT INTO people (id, email, display_name, password_hash) VALUES ($1, $2, $3, $4)`,
        [personId, share.email, displayName.trim(), hash],
      );
      const ctx: ShareContext = { client, now, timers, actor: share.email };
      await acceptShare(ctx, share, share.email);
      const firstPage = await firstPageOf(client, share.diagram_id);
      const sessionCtx = { client, ip, timers, now };
      const session = await createSession(sessionCtx, personId, readSessionCookie(req) ? sha256(readSessionCookie(req) as string) : null);
      return { diagramId: share.diagram_id, firstPageId: firstPage, role: share.role, session };
    });
    if (result.session !== null) {
      res.setHeader('Set-Cookie', sessionCookieHeader(result.session.sessionId));
    }
    sendJson(res, 200, {
      diagramId: result.diagramId,
      firstPageId: result.firstPageId,
      role: result.role,
    });
  } catch (err) {
    if (err instanceof ApiError) {
      sendError(res, err);
      return;
    }
    throw err;
  }
}));

async function firstPageOf(client: PoolClient, diagramId: string): Promise<string> {
  const rows = await client.query<{ id: string }>(
    'SELECT id FROM pages WHERE diagram_id = $1 ORDER BY position ASC LIMIT 1',
    [diagramId],
  );
  if (rows.rowCount === 0) throw errors.notFound();
  return rows.rows[0].id;
}

// ---------------------------------------------------------------------------
// Imports. Creating needs owner or editor; reading needs any role.

// A minimal multipart parser for one `file` part, with the size limits.
function parseMultipart(buf: Buffer, boundary: string): Buffer | null {
  const text = buf.toString('latin1');
  const delim = `--${boundary}`;
  const start = text.indexOf(delim);
  if (start === -1) return null;
  const headerEnd = text.indexOf('\r\n\r\n', start);
  if (headerEnd === -1) return null;
  const contentStart = headerEnd + 4;
  const nextDelim = text.indexOf(`\r\n${delim}`, contentStart);
  if (nextDelim === -1) return null;
  const contentEnd = nextDelim;
  return buf.subarray(contentStart, contentEnd);
}

app.post('/api/diagrams/:diagramId/imports', asyncHandler(async (req, res) => {
  const state = await guard(req, res, { session: 'required', csrf: true });
  if (state === null) return;
  const diagramId = req.params.diagramId;
  const contentType = header(req.headers, 'content-type') ?? '';
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const raw = await readRawBody(req, IMPORT_REQUEST_LIMIT);
  if (raw === null) {
    sendError(res, errors.fileTooLarge());
    return;
  }
  if (match === null) {
    sendError(res, errors.unsupportedMediaType());
    return;
  }
  const fileBuf = parseMultipart(raw, match[1] ?? match[2]);
  if (fileBuf === null || fileBuf.length > IMPORT_FILE_LIMIT) {
    sendError(res, errors.fileTooLarge());
    return;
  }
  const person = state.session?.person as Person;
  const uploadName = importFileName(multipartFileName(raw) ?? 'import.xml');
  try {
    // Errors are checked in the published order: type, parse limit, unsafe,
    // page validation, storage. A refused import writes no page, no import
    // record and no object.
    const doc = importToPage(uploadName, fileBuf);
    const fieldErrors = validatePage(doc);
    if (fieldErrors !== null) throw errors.invalidModel();
    const dangling = danglingConnectors(doc);
    if (dangling !== null) throw errors.invalidModel();
    const result = await withTransaction(async (client) => {
      const access = await requireDiagram(client, state, diagramId);
      await requireRole(access, 'editor');
      const importId = crypto.randomUUID();
      const derived = derivePage(doc);
      const pageId = crypto.randomUUID();
      const position = await client.query<{ n: string }>(
        'SELECT COALESCE(MAX(position), 0) + 1 AS n FROM pages WHERE diagram_id = $1',
        [diagramId],
      );
      await client.query(
        `INSERT INTO pages (id, diagram_id, name, version, doc, derived, position)
         VALUES ($1, $2, $3, 1, $4, $5, $6)`,
        [pageId, diagramId, doc.name, JSON.stringify(doc), JSON.stringify(derived), Number(position.rows[0].n)],
      );
      await client.query(
        `INSERT INTO imports (id, diagram_id, page_id, file_name, size_bytes, sha256, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
        [importId, diagramId, pageId, uploadName, fileBuf.length, sha256Hex(fileBuf), person.id],
      );
      // Evidence: store the exact original bytes and the sanitized model,
      // and confirm both, before anything is committed.
      try {
        const original = await putObject(importOriginalKey(diagramId, importId), fileBuf);
        const model = await putObject(importModelKey(diagramId, importId), JSON.stringify(doc));
        const originalBack = await getObject(importOriginalKey(diagramId, importId));
        if (originalBack.length !== original.sizeBytes || sha256Hex(originalBack) !== original.sha256) {
          throw new Error('verification failed');
        }
        void model;
      } catch {
        throw errors.storageUnavailable();
      }
      const ctx: ShareContext = { client, now: new Date(), timers, actor: person.email };
      await writeDiagramEvent(ctx, diagramId, 'import.created', { importId, fileName: uploadName, sha256: sha256Hex(fileBuf) });
      return { importId, pageId };
    });
    sendJson(res, 201, {
      import: {
        id: result.importId,
        pageId: result.pageId,
        fileName: uploadName,
        sizeBytes: fileBuf.length,
        sha256: sha256Hex(fileBuf),
        createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      },
    });
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.code === 'unsupported_file_type' || err.code === 'invalid_model' || err.code === 'unsafe_file') {
        await withClient(async (client) => {
          const ctx: ShareContext = { client, now: new Date(), timers, actor: person.email };
          await writeDiagramEvent(ctx, diagramId, 'import.rejected', { fileName: uploadName, error: err.code });
        });
      }
      sendError(res, err);
      return;
    }
    throw err;
  }
}));

function multipartFileName(buf: Buffer): string | null {
  const text = buf.toString('utf8');
  const m = /filename="([^"]*)"/.exec(text);
  return m !== null ? m[1] : null;
}

app.get('/api/diagrams/:diagramId/imports', asyncHandler(async (req, res) => {
  const state = await guard(req, res, { session: 'required', csrf: false });
  if (state === null) return;
  const diagramId = req.params.diagramId;
  const imports = await withClient(async (client) => {
    await requireDiagram(client, state, diagramId);
    const rows = await client.query<{
      id: string; page_id: string; file_name: string; size_bytes: number; sha256: string; created_at: Date;
    }>(
      `SELECT id, page_id, file_name, size_bytes, sha256, created_at FROM imports
       WHERE diagram_id = $1 ORDER BY created_at DESC`,
      [diagramId],
    );
    return rows.rows.map((row) => ({
      id: row.id,
      pageId: row.page_id,
      fileName: row.file_name,
      sizeBytes: row.size_bytes,
      sha256: row.sha256,
      createdAt: row.created_at.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    }));
  });
  sendJson(res, 200, { imports });
}));

// The original path never streams bytes; it issues a personal download link.
app.get('/api/diagrams/:diagramId/imports/:importId/original', asyncHandler(async (req, res) => {
  const state = await guard(req, res, { session: 'required', csrf: false });
  if (state === null) return;
  const { diagramId, importId } = req.params;
  const location = await withClient(async (client) => {
    await requireDiagram(client, state, diagramId);
    const row = await client.query<{ file_name: string }>(
      'SELECT file_name FROM imports WHERE id = $1 AND diagram_id = $2',
      [importId, diagramId],
    );
    if (row.rowCount === 0) throw errors.notFound();
    const token = await issueDownloadLink(client, {
      personId: state.session?.person.id as string,
      diagramId,
      importId,
      fileName: row.rows[0].file_name,
    });
    return `/api/downloads/${token}`;
  });
  res.setHeader('Location', location);
  res.status(303).end();
}));

async function issueDownloadLink(
  client: PoolClient,
  bind: { personId: string; diagramId: string; importId?: string; exportId?: string; fileName: string },
): Promise<string> {
  const token = newToken();
  await client.query(
    `INSERT INTO downloads (token_hash, person_id, diagram_id, import_id, export_id, file_name, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())`,
    [sha256(token), bind.personId, bind.diagramId, bind.importId ?? null, bind.exportId ?? null, bind.fileName],
  );
  return token;
}

// ---------------------------------------------------------------------------
// Exports.

app.post('/api/diagrams/:diagramId/exports', asyncHandler(async (req, res) => {
  const request = await beginJson(req, res, { session: 'required', csrf: true });
  if (request === null) return;
  const { state, body } = request;
  const diagramId = req.params.diagramId;
  const payload = body as { pageIds?: unknown } | Record<string, never>;
  const idempotencyKey = header(req.headers, 'idempotency-key');
  if (idempotencyKey !== undefined && !/^[\x20-\x7E]{1,64}$/.test(idempotencyKey)) {
    sendError(res, errors.validation({ idempotencyKey: 'invalid' }));
    return;
  }
  const person = state.session?.person as Person;
  try {
    // Access checks first, then the idempotent replay, then the claim.
    const pages = await withTransaction(async (client) => {
      const access = await requireDiagram(client, state, diagramId);
      await requireRole(access, 'editor');
      let pageIds: string[];
      if (typeof payload !== 'object' || payload === null || !('pageIds' in payload)) {
        const rows = await client.query<{ id: string }>(
          'SELECT id FROM pages WHERE diagram_id = $1 ORDER BY position ASC',
          [diagramId],
        );
        pageIds = rows.rows.map((r) => r.id);
      } else {
        const given = payload.pageIds;
        if (!Array.isArray(given) || given.length === 0 || given.some((id) => typeof id !== 'string') || new Set(given).size !== given.length) {
          throw errors.validation({ pageIds: 'invalid' });
        }
        for (const id of given) {
          const rows = await client.query<{ n: string }>(
            'SELECT count(*)::text AS n FROM pages WHERE diagram_id = $1 AND id = $2',
            [diagramId, id],
          );
          if (rows.rows[0].n === '0') throw errors.notFound();
        }
        pageIds = given as string[];
      }
      const collected: ExportPageInput[] = [];
      for (const id of pageIds) {
        const page = await requirePage(client, diagramId, id);
        collected.push({ doc: page.doc as PageDocument, derived: page.derived as Derived });
      }
      if (idempotencyKey !== undefined) {
        // A stored key replays its response; a running one answers 409.
        const stored = await client.query<{ response_body: unknown }>(
          `SELECT response_body FROM idempotency_keys
           WHERE person_id = $1 AND diagram_id = $2 AND key = $3 AND status = 'stored'`,
          [person.id, diagramId, idempotencyKey],
        );
        if (stored.rowCount !== 0) {
          return { replay: stored.rows[0].response_body, pages: null };
        }
        const claimed = await client.query(
          `INSERT INTO idempotency_keys (person_id, diagram_id, key, status, created_at)
           VALUES ($1, $2, $3, 'in_progress', now())
           ON CONFLICT (person_id, diagram_id, key) DO NOTHING`,
          [person.id, diagramId, idempotencyKey],
        );
        if (claimed.rowCount === 0) {
          throw errors.idempotencyInProgress();
        }
      }
      return { replay: null, pages: collected };
    });
    if (pages.replay !== null) {
      sendJson(res, 201, pages.replay, { 'Idempotent-Replayed': 'true' });
      return;
    }
    const title = await withClient(async (client) => {
      const rows = await client.query<{ title: string }>('SELECT title FROM diagrams WHERE id = $1', [diagramId]);
      return rows.rows[0].title;
    });
    const exportRecord = await createExport(
      { now: new Date(), actor: person.email, actorId: person.id },
      diagramId,
      title,
      pages.pages as ExportPageInput[],
    );
    const responseBody = {
      export: {
        id: exportRecord.id,
        status: exportRecord.status,
        createdAt: exportRecord.createdAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
        createdBy: exportRecord.createdBy,
        pageIds: exportRecord.pageIds,
        files: exportRecord.files,
      },
    };
    if (idempotencyKey !== undefined) {
      await withTransaction(async (client) => {
        await client.query(
          `UPDATE idempotency_keys SET status = 'stored', response_body = $4, export_id = $5
           WHERE person_id = $1 AND diagram_id = $2 AND key = $3`,
          [person.id, diagramId, idempotencyKey, JSON.stringify(responseBody), exportRecord.id],
        );
      });
    }
    sendJson(res, 201, responseBody);
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.code === 'storage_unavailable') {
        // A key whose first attempt failed is not stored; release the claim.
        if (idempotencyKey !== undefined) {
          await withClient(async (client) => {
            await client.query(
              `DELETE FROM idempotency_keys WHERE person_id = $1 AND diagram_id = $2 AND key = $3 AND status = 'in_progress'`,
              [person.id, diagramId, idempotencyKey],
            );
          });
        }
      }
      sendError(res, err);
      return;
    }
    throw err;
  }
}));

app.get('/api/diagrams/:diagramId/exports', asyncHandler(async (req, res) => {
  const state = await guard(req, res, { session: 'required', csrf: false });
  if (state === null) return;
  const diagramId = req.params.diagramId;
  const exports = await withClient(async (client) => {
    const access = await requireDiagram(client, state, diagramId);
    void access;
    const rows = await client.query<{
      id: string; status: string; page_ids: unknown; files: unknown; created_by: string; created_at: Date;
    }>(
      `SELECT id, status, page_ids, files, created_by, created_at FROM exports
       WHERE diagram_id = $1 ORDER BY created_at DESC`,
      [diagramId],
    );
    return rows.rows.map((row) => ({
      id: row.id,
      status: row.status,
      createdAt: row.created_at.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      createdBy: row.created_by,
      pageIds: row.page_ids,
      files: row.files ?? [],
    }));
  });
  sendJson(res, 200, { exports });
}));

app.get('/api/diagrams/:diagramId/exports/:exportId/files/:format', asyncHandler(async (req, res) => {
  const state = await guard(req, res, { session: 'required', csrf: false });
  if (state === null) return;
  const { diagramId, exportId, format } = req.params;
  const location = await withClient(async (client) => {
    await requireDiagram(client, state, diagramId);
    if (format !== 'png' && format !== 'svg' && format !== 'json') throw errors.notFound();
    const rows = await client.query<{ status: string; created_at: Date }>(
      'SELECT status, created_at FROM exports WHERE id = $1 AND diagram_id = $2',
      [exportId, diagramId],
    );
    if (rows.rowCount === 0) throw errors.notFound();
    if (rows.rows[0].status !== 'ready') throw errors.exportNotReady();
    const title = await client.query<{ title: string }>('SELECT title FROM diagrams WHERE id = $1', [diagramId]);
    const fileName = exportFileName(title.rows[0].title, rows.rows[0].created_at, format);
    const token = await issueDownloadLink(client, {
      personId: state.session?.person.id as string,
      diagramId,
      exportId,
      fileName,
    });
    return `/api/downloads/${token}`;
  });
  res.setHeader('Location', location);
  res.status(303).end();
}));

// ---------------------------------------------------------------------------
// Downloads: short-lived links bound to one person and one file.

app.get('/api/downloads/:token', asyncHandler(async (req, res) => {
  const state = await guard(req, res, { session: 'required', csrf: false });
  if (state === null) return;
  const token = req.params.token;
  const result = await withClient(async (client) => {
    const rows = await client.query<{
      person_id: string; diagram_id: string; import_id: string | null; export_id: string | null;
      file_name: string; created_at: Date;
    }>(
      `SELECT person_id, diagram_id, import_id, export_id, file_name, created_at FROM downloads
       WHERE token_hash = $1`,
      [sha256(token)],
    );
    if (rows.rowCount === 0) throw errors.notFound();
    const link = rows.rows[0];
    // The link streams only for the person it was made for, while they still
    // hold a role, and within its lifetime.
    if (link.person_id !== state.session?.person.id) throw errors.notFound();
    const access = await diagramRole(client, state.session?.person.id ?? null, link.diagram_id);
    if (access === null) throw errors.notFound();
    const age = (Date.now() - link.created_at.getTime()) / 1000;
    if (age > timers.downloadLinkSeconds) throw errors.linkExpired();
    return { link, access };
  });
  const { link } = result;
  let bytes: Buffer;
  let contentType: string;
  let fileName: string;
  if (link.import_id !== null) {
    bytes = await getObject(importOriginalKey(link.diagram_id, link.import_id));
    contentType = 'application/octet-stream';
    fileName = link.file_name;
    res.setHeader('X-Content-SHA256', sha256Hex(bytes));
  } else {
    const exportId = link.export_id as string;
    const format = (link.file_name.split('.').pop() ?? 'bin') as 'png' | 'svg' | 'json';
    bytes = await getObject(exportKeyFor(link.diagram_id, exportId, format));
    contentType = format === 'png' ? 'image/png' : format === 'svg' ? 'image/svg+xml' : 'application/json';
    fileName = link.file_name;
  }
  res.setHeader('Content-Security-Policy', 'default-src \'none\'; sandbox');
  res.setHeader('Content-Disposition', contentDisposition(fileName));
  res.setHeader('Content-Type', contentType);
  res.status(200).end(bytes);
}));

function exportKeyFor(diagramId: string, exportId: string, format: 'png' | 'svg' | 'json'): string {
  return `exports/${diagramId}/${exportId}/diagram.${format}`;
}

// ---------------------------------------------------------------------------
// HTML pages and static assets. The server serves only the built browser app,
// its self-hosted fonts and icons, and the API.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

function readIndexHtml(): string {
  const file = path.join(DIST_DIR, 'index.html');
  if (!fs.existsSync(file)) {
    return '<!DOCTYPE html><html><head><title>Scopewright</title></head><body><h1>Scopewright</h1></body></html>';
  }
  return fs.readFileSync(file, 'utf8');
}

// Every HTML response carries the nonce-based policy, and every script carries
// the nonce.
function serveHtml(req: Request, res: Response, status: number): void {
  const nonce = newNonce();
  let html = readIndexHtml();
  html = html.replace(/<script(?![^>]*nonce=)/g, `<script nonce="${nonce}"`);
  res.setHeader('Content-Security-Policy', cspForHtml(nonce));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.path.startsWith('/invite/')) {
    res.setHeader('Referrer-Policy', 'no-referrer');
  }
  res.status(status).send(html);
}

// Landing routes: signed-out visits to / or /d/... redirect to /signin.
const NEXT_SAFE = /[^A-Za-z0-9\-_.!~*'()]/g;

function encodeNext(pathAndQuery: string): string {
  return pathAndQuery.replace(NEXT_SAFE, (ch) =>
    Array.from(new TextEncoder().encode(ch)).map((b) => '%' + b.toString(16).toUpperCase().padStart(2, '0')).join(''));
}

app.get('/signin', (req, res) => {
  serveHtml(req, res, 200);
});

app.get('/', (req, res) => {
  const state = req.state;
  if (state !== undefined && state.session === null) {
    res.redirect(302, `/signin?next=${encodeNext(req.originalUrl)}`);
    return;
  }
  serveHtml(req, res, 200);
});

app.get('/invite/:token', (req, res) => {
  serveHtml(req, res, 200);
});

// Diagram addresses: /d/<id> shows /d/<id>/p/<firstPageId> without a history
// entry. A page the person cannot see shows the 404 page at the same address.
app.get('/d/:diagramId', asyncHandler(async (req, res) => {
  const state = req.state;
  if (state !== undefined && state.session === null) {
    res.redirect(302, `/signin?next=${encodeNext(req.originalUrl)}`);
    return;
  }
  const firstPage = await withClient(async (client) => {
    const access = await diagramRole(client, state?.session?.person.id ?? null, req.params.diagramId);
    if (access === null) return null;
    const rows = await client.query<{ id: string }>(
      'SELECT id FROM pages WHERE diagram_id = $1 ORDER BY position ASC LIMIT 1',
      [req.params.diagramId],
    );
    return rows.rowCount === 0 ? null : rows.rows[0].id;
  });
  if (firstPage === null) {
    serveHtml(req, res, 404);
    return;
  }
  res.redirect(302, `/d/${req.params.diagramId}/p/${firstPage}`);
}));

app.get('/d/:diagramId/p/:pageId', asyncHandler(async (req, res) => {
  const state = req.state;
  if (state !== undefined && state.session === null) {
    res.redirect(302, `/signin?next=${encodeNext(req.originalUrl)}`);
    return;
  }
  const visible = await withClient(async (client) => {
    try {
      await requireDiagramAccess(client, state?.session?.person.id ?? null, req.params.diagramId);
      await requirePage(client, req.params.diagramId, req.params.pageId);
      return true;
    } catch {
      return false;
    }
  });
  if (!visible) {
    serveHtml(req, res, 404);
    return;
  }
  serveHtml(req, res, 200);
}));

// Static assets from the built browser app.
app.use(express.static(DIST_DIR, { index: false, fallthrough: true, maxAge: '1h', extensions: false }));

// Any other address answers the not-found page.
app.use((req, res) => {
  if (req.method === 'GET' || req.method === 'HEAD') {
    serveHtml(req, res, 404);
    return;
  }
  res.status(404).json({ error: 'not_found', message: "We couldn't find that." });
});

// ---------------------------------------------------------------------------
// Errors: unexpected failures answer the published internal error.

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return;
  if (err instanceof ApiError) {
    sendError(res, err);
    return;
  }
  // Real failures are logged without secrets.
  console.error('unexpected error:', err instanceof Error ? err.message : 'unknown');
  sendError(res, errors.internal());
});

// ---------------------------------------------------------------------------
// Boot.

let dbReady = false;

async function waitForDb(): Promise<void> {
  for (;;) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

async function boot(): Promise<void> {
  // The API starts answering at once; /api/health reports starting until the
  // database connects.
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Scopewright listening on ${PORT}`);
  });
  void server;
  await waitForDb();
  await applySchemaAndSeed();
  dbReady = true;
  // Retry queued mail at least every 10 seconds.
  setInterval(() => {
    void deliverQueued().catch(() => undefined);
  }, 10000).unref();
  // Attempt delivery at once at start, for messages queued while we were down.
  void deliverQueued().catch(() => undefined);
}

void boot();

