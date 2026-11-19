import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Services } from './services.js';
import type { Ctx } from './ctx.js';
import { ApiError, NOTICES, errorBody } from './errors.js';
import { now, nowIso } from './clock.js';
import { verifyPassword, hashPassword } from './passwords.js';
import { loadMapState } from './context.js';
import type { Role } from '../shared/types.js';
import { seedRoutes } from './grading.js';
import { storageHealthy } from './storage.js';
import { mapRoutes, roleOnMap, mapPayloadFor } from './routes/maps.js';
import { shareRoutes, commentRoutes, presentationRoutes, fileRoutes, clipboardRoutes } from './routes/misc.js';

/**
 * The API dispatch. Every error goes through the one writer; the
 * published precedence order is applied by the checks in order:
 * 413 (before read) → 401 → 429 → 404 → replay → 403 → 409 → 422 →
 * 409 quota → 503.
 */

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

function noContent(res: ServerResponse): void {
  res.writeHead(204);
  res.end();
}

export async function handleApi(ctx: Ctx, svc: Services): Promise<void> {
  const { res } = ctx;
  try {
    await route(ctx, svc);
  } catch (e) {
    if (e instanceof ApiError) {
      const headers: Record<string, string> = {};
      if (e.retryAfter !== undefined) headers['retry-after'] = String(e.retryAfter);
      res.writeHead(e.status, { 'content-type': 'application/json; charset=utf-8', ...headers });
      res.end(JSON.stringify(errorBody(e)));
      return;
    }
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'storage_unavailable', message: 'Unexpected server error.' }));
  }
}

async function requireUser(ctx: Ctx): Promise<{ id: string; username: string }> {
  if (!ctx.user) throw new ApiError('unauthenticated', 'Sign in to continue.');
  return ctx.user;
}

export async function rateLimit(svc: Services, kind: 'op' | 'login', key: string): Promise<void> {
  const table = kind === 'op' ? 'op_rate' : 'login_rate';
  const limit = kind === 'op' ? svc.settings.op_rate : svc.settings.login_rate;
  const windowMs = 60_000;
  const t = now();
  const windowStart = new Date(Math.floor(t.getTime() / windowMs) * windowMs);
  const r = await svc.db.one<{ count: string }>(
    `SELECT count FROM ${table} WHERE username = $1 AND window_start = $2`,
    [key, windowStart.toISOString()],
  );
  if (r && Number(r.count) >= limit) {
    const retry = Math.max(1, Math.ceil((windowStart.getTime() + windowMs - t.getTime()) / 1000));
    throw new ApiError('rate_limited', NOTICES.rateLimited, { retryAfter: retry });
  }
  await svc.db.query(
    `INSERT INTO ${table} (username, window_start, count) VALUES ($1,$2,1)
     ON CONFLICT (username, window_start) DO UPDATE SET count = ${table}.count + 1`,
    [key, windowStart.toISOString()],
  );
}

async function route(ctx: Ctx, svc: Services): Promise<void> {
  const p = ctx.path;
  const method = ctx.method;

  if (p === '/api/health' && method === 'GET') {
    const healthy = await storageHealthy({ s3: svc.s3, down: svc.storageDown });
    json(ctx.res, 200, { status: healthy ? 'ok' : 'unavailable' });
    return;
  }
  if (p.startsWith('/api/grading')) {
    if (!svc.settings.grading) throw new ApiError('not_found', NOTICES.unknownPage);
    await seedRoutes(ctx, svc);
    return;
  }
  if (p === '/api/auth/signup' && method === 'POST') return signup(ctx, svc);
  if (p === '/api/auth/login' && method === 'POST') return login(ctx, svc);
  if (p === '/api/auth/logout' && method === 'POST') {
    if (!ctx.user) throw new ApiError('unauthenticated', 'Sign in to continue.');
    await svc.db.query('DELETE FROM sessions WHERE user_id = $1', [ctx.user.id]);
    setCookie(ctx.res, 'sprig_session', '', 0);
    return noContent(ctx.res);
  }
  if (p === '/api/me' && method === 'GET') {
    const u = await requireUser(ctx);
    const sess = await svc.db.one<{ expires_at: Date }>(
      'SELECT expires_at FROM sessions WHERE id = $1', [ctx.cookies.sprig_session],
    );
    const unread = await svc.db.one<{ n: string }>('SELECT count(*)::text AS n FROM mentions WHERE username = $1 AND read = FALSE', [u.username]);
    json(ctx.res, 200, {
      user: { id: u.id, username: u.username },
      inbox_unread: Number(unread?.n ?? 0),
      server_time: nowIso(),
      session_expires_at: sess?.expires_at.toISOString() ?? null,
    });
    return;
  }
  if (p === '/api/inbox' && method === 'GET') {
    const u = await requireUser(ctx);
    const rows = await svc.db.query<{ id: string; map_id: string; topic_id: string; comment_id: string; by: string; read: boolean }>('SELECT id, map_id, topic_id, comment_id, "by", read FROM mentions WHERE username = $1 ORDER BY created_at DESC', [u.username]);
    const unread = rows.rows.filter((r) => !r.read).length;
    json(ctx.res, 200, { mentions: rows.rows, unread });
    return;
  }
  const inRead = p.match(/^\/api\/inbox\/([^/]+)\/read$/);
  if (inRead && method === 'POST') {
    const u = await requireUser(ctx);
    await svc.db.query('UPDATE mentions SET read = TRUE WHERE id = $1 AND username = $2', [inRead[1], u.username]);
    const rows = await svc.db.query<{ n: string }>('SELECT count(*)::text AS n FROM mentions WHERE username = $1 AND read = FALSE', [u.username]);
    json(ctx.res, 200, { unread: Number(rows.rows[0].n) });
    return;
  }
  if (p === '/api/maps' && method === 'GET') {
    const u = await requireUser(ctx);
    const rows = await svc.db.query<{ id: string; title: string; revision: string; updated_at: Date; owner_id: string; role: string; topic_count: string }>(
      `SELECT m.id, m.title, m.revision, m.updated_at, m.owner_id,
              COALESCE((SELECT role FROM members mm WHERE mm.map_id = m.id AND mm.username = $2), 'viewer') AS role,
              (SELECT count(*)::text AS n FROM topics t WHERE t.map_id = m.id) AS topic_count
       FROM maps m
       WHERE m.owner_id = $1 OR EXISTS (SELECT 1 FROM members mm WHERE mm.map_id = m.id AND mm.username = $2)
       ORDER BY m.updated_at DESC`,
      [u.id, u.username],
    );
    json(ctx.res, 200, {
      maps: rows.rows.map((r) => ({
        id: r.id, title: r.title, role: r.owner_id === u.id ? 'owner' : (r.role as Role),
        updated_at: r.updated_at.toISOString(),
        revision: Number(r.revision), topic_count: Number(r.topic_count),
      })),
    });
    return;
  }
  if (p === '/api/maps' && method === 'POST') {
    const u = await requireUser(ctx);
    const body = ctx.body as { title?: string; template?: string | null };
    const title = (body.title ?? '').replace(/\s+/g, ' ').trim();
    if (title.length < 1 || [...title].length > 200) throw new ApiError('invalid', 'Invalid title.', { fields: { title: 'Title must be 1 to 200 characters.' } });
    const template = body.template ?? null;
    if (template !== null && !['street-fair', 'exam-revision', 'house-move'].includes(template)) {
      throw new ApiError('invalid', 'Invalid template.', { fields: { template: 'Unknown template.' } });
    }
    const mapId = randomUUID();
    await svc.db.transaction(async (c) => {
      await c.query('INSERT INTO maps (id, title, owner_id, revision) VALUES ($1,$2,$3,1)', [mapId, title, u.id]);
      await createTemplateTopics(c, mapId, template, title);
    });
    const loaded = await loadMapState(svc.db, mapId);
    json(ctx.res, 201, { map: (await mapPayloadFor(loaded, 'owner', svc, u.username)).map });
    return;
  }
  if (p.startsWith('/api/share/')) return shareRoutes(ctx, svc);
  const cm = p.match(/^\/api\/comments\/([^/]+)\/(resolve|reopen)$/);
  if (cm && method === 'POST') return commentRoutes(ctx, svc, cm[1], cm[2]);
  const pr = p.match(/^\/api\/presentations\/([^/]+)\/(state|step)$/);
  if (pr && method === 'POST') return presentationRoutes(ctx, svc, pr[1], pr[2] as 'state' | 'step');
  const prc = p.match(/^\/api\/presentations\/by-code\/([^/]+)$/);
  if (prc && method === 'GET') return presentationRoutes(ctx, svc, prc[1], null);
  if (p.startsWith('/api/attachments/')) return fileRoutes(ctx, svc);
  if (p.startsWith('/api/exports/')) return fileRoutes(ctx, svc);
  if (p === '/api/clipboard' && method === 'POST') return clipboardRoutes(ctx, svc);
  if (p.startsWith('/api/maps/') && svc.dbReady) {
    const m = p.match(/^\/api\/maps\/([^/]+)(\/.*)?$/);
    if (m) return mapRoutes(ctx, svc, m[1], m[2] ?? '');
  }
  throw new ApiError('not_found', NOTICES.unknownPage);
}

async function signup(ctx: Ctx, svc: Services): Promise<void> {
  const body = ctx.body as { username?: string; password?: string };
  const username = (body.username ?? '').toLowerCase();
  const password = body.password ?? '';
  const fields: Record<string, string> = {};
  if (!/^[a-z0-9_]{3,24}$/.test(username)) fields.username = NOTICES.usernameField;
  if (password.length < 8) fields.password = NOTICES.passwordField;
  if (Object.keys(fields).length > 0) throw new ApiError('invalid', 'Check the fields.', { fields });
  const existing = await svc.db.one('SELECT id FROM users WHERE username = $1', [username]);
  if (existing) throw new ApiError('username_taken', NOTICES.taken);
  const id = randomUUID();
  const hash = await hashPassword(password);
  await svc.db.query('INSERT INTO users (id, username, password_hash) VALUES ($1,$2,$3)', [id, username, hash]);
  await openSession(ctx, svc, id);
  json(ctx.res, 201, { user: { id, username } });
}

async function login(ctx: Ctx, svc: Services): Promise<void> {
  const body = ctx.body as { username?: string; password?: string };
  const username = (body.username ?? '').toLowerCase();
  const password = body.password ?? '';
  await rateLimit(svc, 'login', username || '-');
  const user = await svc.db.one<{ id: string; password_hash: string }>('SELECT id, password_hash FROM users WHERE username = $1', [username]);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    throw new ApiError('bad_credentials', NOTICES.wrongCredentials);
  }
  await openSession(ctx, svc, user.id);
  json(ctx.res, 200, { user: { id: user.id, username } });
}

async function openSession(ctx: Ctx, svc: Services, userId: string): Promise<void> {
  const id = randomUUID();
  const t = now();
  const expires = new Date(t.getTime() + svc.settings.session_ttl_ms);
  await svc.db.query('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ($1,$2,$3,$4)', [
    id, userId, t.toISOString(), expires.toISOString(),
  ]);
  setCookie(ctx.res, 'sprig_session', id, null);
}

export function setCookie(res: ServerResponse, name: string, value: string, maxAge: number | null): void {
  const base = `${name}=${value}; Path=/; SameSite=Lax; HttpOnly`;
  res.setHeader('set-cookie', maxAge === 0 ? `${base}; Max-Age=0` : base);
}

/** Create the topics of a new map, blank or from one of the three templates. */
async function createTemplateTopics(c: PoolClient, mapId: string, template: string | null, title: string): Promise<void> {
  const mk = (id: string, parentId: string | null, rank: number, t: string, task: unknown = null): unknown[] => [
    mapId, id, parentId, rank, false, null, null, t, '', null, null, null, null, JSON.stringify(task), null, false, '[]',
  ];
  const insert = async (id: string, parentId: string | null, rank: number, t: string, task: unknown = null) => {
    await c.query(
      `INSERT INTO topics (map_id, id, parent_id, rank, floating, x, y, title, note, icon, colour, shape, side_pin, task, locked_by, restricted, attachments)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17::jsonb)`,
      [mapId, id, parentId, rank, false, null, null, t, '', null, null, null, null, JSON.stringify(task), null, false, '[]'],
    );
  };
  await insert('t-root', null, 0, template === null ? title : title);
  void mk;
  if (template === 'street-fair') {
    await insert('t-stalls', 't-root', 0, 'Stalls');
    await insert('t-music', 't-root', 1, 'Music stage');
    await insert('t-vol', 't-root', 2, 'Volunteers and rotas');
    await insert('t-budget', 't-root', 3, 'Budget');
    await insert('t-morning', 't-vol', 0, 'Morning shift');
    await insert('t-afternoon', 't-vol', 1, 'Afternoon shift');
  } else if (template === 'exam-revision') {
    await insert('t-bio', 't-root', 0, 'Biology');
    await insert('t-cells', 't-bio', 0, 'Cells');
    await insert('t-genetics', 't-bio', 1, 'Genetics');
    await insert('t-history', 't-root', 1, 'History');
    await insert('t-maths', 't-root', 2, 'Maths', { percent: 0, weight: 1, state: 'open', priority: 'normal', due: null, assignee: null });
    await insert('t-papers', 't-root', 3, 'Past papers');
  } else if (template === 'house-move') {
    await insert('t-boxes', 't-root', 0, 'Boxes');
    await insert('t-utilities', 't-root', 1, 'Utilities');
    await insert('t-address', 't-root', 2, 'Change of address');
    await insert('t-day', 't-root', 3, 'Moving day');
  }
}

export { json, noContent, requireUser };
export type { Ctx, Services };
export { roleOnMap } from './routes/maps.js';
