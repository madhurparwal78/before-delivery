import type { IncomingMessage, ServerResponse } from 'node:http';
import { Ctx, type RouteResult } from './context.js';
import { ApiError, errors } from './errors.js';
import { INSTANCE_HEADER, parseCookies, readJsonBody, sendJson } from './http.js';
import {
  membershipIn,
  resolveAuthSession,
  roleAllows,
  SESSION_COOKIE,
  type Capability,
} from './services/auth.js';
import { pool } from './db/pool.js';
import { serveStatic } from './static.js';

export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  path: string;
  auth: 'open' | 'user' | 'workspace';
  capability?: Capability;
  handle: (ctx: Ctx) => Promise<RouteResult | void>;
}

interface Match {
  route: Route;
  params: Record<string, string>;
}

function matchRoute(routes: Route[], method: string, path: string): Match | null {
  const parts = path.split('/').filter((part) => part !== '');
  for (const route of routes) {
    if (route.method !== method) continue;
    const template = route.path.split('/').filter((part) => part !== '');
    if (template.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < template.length; index += 1) {
      const slot = template[index];
      if (slot.startsWith(':')) params[slot.slice(1)] = decodeURIComponent(parts[index]);
      else if (slot !== parts[index]) {
        matched = false;
        break;
      }
    }
    if (matched) return { route, params };
  }
  return null;
}

async function isFounder(userId: string): Promise<boolean> {
  const { rows } = await pool.query<{ one: number }>(
    `select 1 as one from memberships where user_id = $1 and role = 'founder' limit 1`,
    [userId],
  );
  return rows.length > 0;
}

export function createHandler(routes: Route[], instanceId: string) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader(INSTANCE_HEADER, instanceId);
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';

    if (!url.pathname.startsWith('/api/')) {
      await serveStatic(url.pathname, res);
      return;
    }

    try {
      const match = matchRoute(routes, method, url.pathname);
      if (!match) throw errors.notFound();
      const body = await readJsonBody(req);
      const rawKey = req.headers['idempotency-key'];
      const key = typeof rawKey === 'string' && rawKey.length > 0 ? rawKey : null;
      const ctx = new Ctx(req, res, match.params, url.searchParams, body, instanceId, key);

      if (match.route.auth !== 'open') {
        const cookies = parseCookies(req.headers.cookie);
        const sessionId = cookies.get(SESSION_COOKIE);
        const user = sessionId ? await resolveAuthSession(sessionId) : null;
        if (!user) throw errors.sessionRequired();
        ctx.user = user;
      }

      if (match.route.auth === 'workspace') {
        const membership = await membershipIn(ctx.person.id, ctx.workspaceId);
        if (!membership) throw errors.forbidden();
        ctx.membership = membership;
        if (match.route.capability && !roleAllows(membership.role, match.route.capability)) {
          throw errors.forbidden();
        }
      } else if (match.route.capability === 'found') {
        if (!(await isFounder(ctx.person.id))) throw errors.forbidden();
      }

      const result = await match.route.handle(ctx);
      if (!result) return;
      if (result.cookie) res.setHeader('Set-Cookie', result.cookie);
      if (result.status === 204) {
        res.writeHead(204);
        res.end();
        return;
      }
      sendJson(res, result.status, result.body);
    } catch (error) {
      if (error instanceof ApiError) {
        sendJson(res, error.status, error.body());
        return;
      }
      process.stderr.write(`${String(error)}\n`);
      sendJson(res, 500, { error: { code: 'server_error', message: 'Something went wrong.' } });
    }
  };
}
