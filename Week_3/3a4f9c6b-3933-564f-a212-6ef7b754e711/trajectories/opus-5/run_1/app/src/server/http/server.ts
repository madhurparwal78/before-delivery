import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { SESSION_COOKIE, personForSession } from '../auth.js';
import { ApiError, errors } from '../errors.js';
import { readRequestKey, withRequestKey } from '../request-keys.js';
import { findClusterByToken } from '../repo.js';
import { agentRoutes } from '../routes/agent.js';
import { BUNDLE_BODY_LIMIT, bundleRoutes } from '../routes/bundles.js';
import { projectRoutes } from '../routes/projects.js';
import { promotionRoutes } from '../routes/promotions.js';
import { sessionRoutes } from '../routes/session.js';
import { windowRoutes } from '../routes/windows.js';
import { asObject } from '../validate.js';
import { serveClient } from './static.js';
import type { Ctx, Reply, Route } from './types.js';

const DEFAULT_BODY_LIMIT = 64_000;

const ROUTES: Route[] = [
  ...sessionRoutes,
  ...projectRoutes,
  ...bundleRoutes,
  ...promotionRoutes,
  ...windowRoutes,
  ...agentRoutes,
];

interface Matched {
  route: Route;
  params: Record<string, string>;
}

function matchRoute(method: string, path: string): Matched | null {
  const segments = path.split('/').filter((segment) => segment !== '');
  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const template = route.template.split('/').filter((segment) => segment !== '');
    if (template.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let matches = true;
    for (const [index, part] of template.entries()) {
      const actual = segments[index] as string;
      if (part.startsWith(':')) {
        params[part.slice(1)] = decodeURIComponent(actual);
        continue;
      }
      if (part !== actual) {
        matches = false;
        break;
      }
    }
    if (matches) return { route, params };
  }
  return null;
}

/** Any path that is not a known route must look identical to a path that does not exist. */
function bodyLimitFor(method: string, path: string): number {
  return method === 'POST' && /^\/api\/projects\/[^/]+\/bundles$/.test(path)
    ? BUNDLE_BODY_LIMIT
    : DEFAULT_BODY_LIMIT;
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > limit) throw errors.payloadTooLarge(limit);

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const piece = chunk as Buffer;
    total += piece.length;
    if (total > limit) throw errors.payloadTooLarge(limit);
    chunks.push(piece);
  }
  return Buffer.concat(chunks);
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

/** The browser may only talk to its own origin, and no cross-origin permission is ever granted. */
function refuseForeignOrigin(req: IncomingMessage): void {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const origin = req.headers.origin;
  if (origin === undefined || origin === 'null') return;
  const host = req.headers.host;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw errors.crossOrigin();
  }
  if (parsed.host !== host) throw errors.crossOrigin();
}

function write(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { ...(reply.headers ?? {}) };
  let payload: Buffer | null = null;
  if (reply.raw) {
    payload = reply.raw;
  } else if (reply.json !== undefined) {
    payload = Buffer.from(JSON.stringify(reply.json), 'utf8');
    headers['content-type'] = 'application/json; charset=utf-8';
  }
  headers['cache-control'] = headers['cache-control'] ?? 'no-store';
  if (payload) headers['content-length'] = String(payload.length);
  res.writeHead(reply.status, headers);
  res.end(payload ?? undefined);
}

function errorReply(cause: unknown): Reply {
  if (cause instanceof ApiError) return { status: cause.status, json: cause.body() };
  process.stderr.write(`unhandled: ${String(cause)}\n`);
  return {
    status: 500,
    json: { error: 'internal', message: 'Keelson could not complete that request.' },
  };
}

async function authenticate(route: Route, req: IncomingMessage, ctx: Ctx): Promise<void> {
  if (route.access === 'agent') {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const cluster = token === '' ? null : await findClusterByToken(token);
    if (!cluster) throw errors.unauthenticated();
    ctx.cluster = cluster;
    return;
  }
  if (route.access === 'session') {
    if (!ctx.sessionToken) throw errors.unauthenticated();
    const person = await personForSession(ctx.sessionToken);
    if (!person) throw errors.unauthenticated();
    ctx.person = person;
    return;
  }
  if (ctx.sessionToken) ctx.person = await personForSession(ctx.sessionToken);
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? 'GET';
  const matched = matchRoute(method, url.pathname);

  let reply: Reply;
  try {
    const raw = await readBody(req, matched?.route.bodyLimit ?? bodyLimitFor(method, url.pathname));
    const contentType = (req.headers['content-type'] ?? '').split(';')[0]?.trim();
    if (raw.length > 0 && contentType !== 'application/json') throw errors.unsupportedMediaType();
    refuseForeignOrigin(req);
    if (!matched) throw errors.notFound();

    let parsed: unknown = {};
    if (raw.length > 0) {
      try {
        parsed = JSON.parse(raw.toString('utf8'));
      } catch {
        throw errors.validation({ body: 'Send a JSON object.' });
      }
    }

    const ctx: Ctx = {
      method,
      path: url.pathname,
      params: matched.params,
      query: url.searchParams,
      body: asObject(parsed),
      rawBody: parsed,
      person: null,
      cluster: null,
      sessionToken: readCookie(req.headers.cookie, SESSION_COOKIE),
    };

    await authenticate(matched.route, req, ctx);
    if (matched.route.authorize) {
      await matched.route.authorize(ctx);
      reply = await runKeyed(matched.route, ctx, req);
    } else {
      reply = await matched.route.handler(ctx);
    }
  } catch (cause) {
    reply = errorReply(cause);
  }
  write(res, reply);
}

async function runKeyed(route: Route, ctx: Ctx, req: IncomingMessage): Promise<Reply> {
  const person = ctx.person;
  if (!person) throw errors.unauthenticated();
  const key = readRequestKey(req.headers['request-key'] as string | undefined);
  const { reply, replayed } = await withRequestKey(
    person.id,
    ctx.method,
    ctx.path,
    key,
    ctx.rawBody,
    async () => {
      try {
        const outcome = await route.handler(ctx);
        return { status: outcome.status, body: outcome.json };
      } catch (cause) {
        if (cause instanceof ApiError) return { status: cause.status, body: cause.body() };
        throw cause;
      }
    },
  );
  return {
    status: reply.status,
    json: reply.body,
    ...(replayed ? { headers: { 'request-replayed': 'true' } } : {}),
  };
}

export function startServer(port: number, ready: () => boolean): void {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (url.pathname === '/api/health') {
      write(res, ready() ? { status: 200, json: { status: 'ok' } } : { status: 503, json: { status: 'starting' } });
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      void handleApi(req, res, url);
      return;
    }
    void serveClient(req, res, url).catch(() => write(res, { status: 404, raw: Buffer.alloc(0) }));
  });
  server.listen(port, '0.0.0.0');
}
