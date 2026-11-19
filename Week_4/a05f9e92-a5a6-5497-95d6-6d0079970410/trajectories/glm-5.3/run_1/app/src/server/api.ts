// The API: every endpoint under /api, with the published error order.

import { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { Db, clock } from './db.js';
import { ApiError, unauthenticated, notFound, forbidden, operatorOnly, rateLimited } from './errors.js';
import { sendJson } from './apibase.js';
import { Session, SessionUser, loadSession, readSessionCookie, setSessionCookie, clearSessionCookie, actingAs } from './auth.js';
import { checkRate } from './ratelimit.js';
import { verifyPassword } from './seeddata.js';
import { Ctx } from './server.js';
import { Role, TABLES } from '../shared/model.js';

export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  ctx: Ctx;
  url: URL;
  method: string;
  path: string;
  session: Session | null;
  body: Record<string, unknown>;
  /** The raw request body, kept for multipart uploads. */
  rawBody?: Buffer | null;
}

/** A signed-in user's effective identity (the impersonated one when set). */
export function currentUser(session: Session | null): SessionUser | null {
  if (!session) return null;
  return actingAs(session);
}

export function requireUser(session: Session | null): SessionUser {
  if (!session) throw unauthenticated();
  return actingAs(session);
}

export function requireOperator(session: Session | null): SessionUser {
  const user = requireUser(session);
  if (!user.roles.includes('operator')) throw operatorOnly();
  return user;
}

export function setting(ctx: Ctx, name: string): number {
  const value = ctx.settings.get(name);
  return Number(value ?? 0);
}

/** Dispatch an API request. Called from the HTTP handler. */
export async function handleApi(route: RouteContext): Promise<void> {
  const { method } = route;
  const path = decodeURIComponent(route.path);

  if (path === '/api/health' && method === 'GET') {
    sendJson(route.res, 200, { status: route.ctx.storage.isAvailable ? 'ok' : 'unavailable' });
    return;
  }

  if (path.startsWith('/api/grading/')) {
    const key = route.req.headers['x-grading-key'];
    if (key !== String(route.ctx.settings.get('GRADING_KEY') ?? 'switchyard-grading-local')) {
      throw notFound();
    }
    const { handleGradingRoute } = await import('./grading.js');
    await handleGradingRoute(route);
    return;
  }

  if (path === '/api/session' && method === 'POST') return void await signIn(route);
  if (path === '/api/session' && method === 'GET') return void await getSession(route);
  if (path === '/api/session' && method === 'DELETE') return void await signOut(route);

  const user = requireUser(route.session);

  if (path === '/api/departments' && method === 'GET') return void await listDepartments(route);
  if (path === '/api/users' && method === 'GET') return void await listUsers(route, user);
  if (path === '/api/storage' && method === 'GET') return void await storageStatus(route);

  // Remaining endpoints are dispatched by feature modules.
  const { dispatchRecords, dispatchConfig, dispatchCatalog, dispatchMap,
          dispatchChanges, dispatchOnCall, dispatchInboxApi, dispatchFiles } = await import('./routes/index.js');
  if (await dispatchRecords(route, user, path)) return;
  if (await dispatchConfig(route, user, path)) return;
  if (await dispatchCatalog(route, user, path)) return;
  if (await dispatchMap(route, user, path)) return;
  if (await dispatchChanges(route, user, path)) return;
  if (await dispatchOnCall(route, user, path)) return;
  if (await dispatchInboxApi(route, user, path)) return;
  if (await dispatchFiles(route, user, path)) return;

  throw notFound();
}

async function signIn(route: RouteContext): Promise<void> {
  const { ctx, body, res } = route;
  const username = String(body.username ?? '');
  const password = String(body.password ?? '');

  const limit = Number(ctx.settings.get('LOGIN_RATE_LIMIT_PER_MINUTE') ?? 10);
  const rate = await checkRate(ctx.db, 'login', username, limit);
  if (!rate.ok) throw rateLimited(rate.retryAfter);

  const found = await ctx.db.query(
    `SELECT username, password_hash FROM people WHERE username = $1 AND password_hash IS NOT NULL AND active`,
    [username],
  );
  if (!found.rows.length || !verifyPassword(password, String(found.rows[0].password_hash))) {
    throw new ApiError(401, 'bad_credentials', 'That username and password do not match.');
  }

  const token = randomBytes(24).toString('hex');
  await ctx.db.query(`INSERT INTO sessions(token, username) VALUES ($1,$2)`, [token, username]);
  setSessionCookie(res, token);
  sendJson(res, 200, { user: await loadUser(ctx.db, username) });
}

export async function loadUser(db: Db, username: string): Promise<SessionUser> {
  const res = await db.query(
    `SELECT username, display_name, roles, department, time_zone, digest FROM people WHERE username = $1`,
    [username],
  );
  const row = res.rows[0];
  return {
    username: row.username,
    display_name: row.display_name,
    roles: (row.roles ?? []) as Role[],
    department: row.department ?? '',
    time_zone: row.time_zone,
    active: true,
    digest: row.digest === 'daily' ? 'daily' : 'immediate',
  };
}

async function getSession(route: RouteContext): Promise<void> {
  const user = requireUser(route.session);
  const impersonating = route.session?.impersonating ?? null;
  sendJson(route.res, 200, {
    user: {
      username: user.username, display_name: user.display_name,
      roles: user.roles, department: user.department, time_zone: user.time_zone,
    },
    workspace: route.session?.workspace === 'test' ? 'test' : 'live',
    impersonating: impersonating ? { username: impersonating.username, display_name: impersonating.display_name } : null,
  });
}

async function signOut(route: RouteContext): Promise<void> {
  if (route.session) {
    await route.ctx.db.query(`DELETE FROM sessions WHERE token = $1`, [route.session.token]);
  }
  clearSessionCookie(route.res);
  route.res.writeHead(204);
  route.res.end();
}

async function listDepartments(route: RouteContext): Promise<void> {
  requireUser(route.session);
  const res = await route.ctx.db.query(
    `SELECT d.name, count(p.username)::int AS members FROM departments d
     LEFT JOIN people p ON p.department = d.name GROUP BY d.name ORDER BY d.name`,
  );
  sendJson(route.res, 200, {
    departments: res.rows.map((r: Record<string, unknown>) => ({ name: r.name, members: Number(r.members) })),
  });
}

async function listUsers(route: RouteContext, user: SessionUser): Promise<void> {
  if (!(user.roles.includes('operator') || user.roles.includes('technician'))) throw forbidden();
  const res = await route.ctx.db.query(
    `SELECT p.username, p.display_name, p.roles, p.department, p.time_zone, p.out_of_office,
            p.capacity, p.active, p.delegate, p.delegate_from, p.delegate_to
     FROM people p ORDER BY p.username`,
  );
  const now = clock.nowMs();
  sendJson(route.res, 200, {
    users: res.rows.map((r: Record<string, unknown>) => ({
      username: r.username,
      display_name: r.display_name,
      roles: r.roles ?? [],
      department: r.department,
      time_zone: r.time_zone,
      out_of_office: Boolean(r.out_of_office),
      capacity: r.capacity ?? null,
      active: Boolean(r.active),
      delegate: activeDelegate(r, now),
    })),
  });
}

function activeDelegate(row: Record<string, unknown>, now: number): string | null {
  const delegate = row.delegate as string | null;
  if (!delegate) return null;
  const from = row.delegate_from ? new Date(row.delegate_from as Date).getTime() : null;
  const to = row.delegate_to ? new Date(row.delegate_to as Date).getTime() : null;
  if (from !== null && now < from) return null;
  if (to !== null && now > to) return null;
  return delegate;
}

async function storageStatus(route: RouteContext): Promise<void> {
  requireUser(route.session);
  const res = await route.ctx.db.query(`SELECT count(*)::int AS n FROM attachments WHERE status = 'queued'`);
  sendJson(route.res, 200, {
    storage: route.ctx.storage.isAvailable ? 'available' : 'unavailable',
    queued_uploads: Number(res.rows[0].n),
  });
}
