import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { createRequestHandler } from 'react-router';
import { ApiError } from '../domain/errors.js';
import { config } from './config.js';
import { tick, readiness, isReady } from './readiness.js';
import { isRequestIdSegment } from '../domain/time.js';
import { resolveViewer } from './bridge.js';
import { SESSION_COOKIE, endSessionByToken } from './sessions.js';
import {
  handleSignIn, handleQueue, handleRaise, handleDetail, handleDecision, handleCancel,
} from './api.js';
import {
  handleGetPolicy, handlePutPolicy, handlePolicyHistory, handleAudit,
  handleTrailCsv, handleTrailVerify, handleCalendar, handleMintShareLink,
  handleRevokeShareLink,
} from './api2.js';


// ---------------------------------------------------------------------------
// API surface
// ---------------------------------------------------------------------------

const API = {
  '/api/health': { GET: { session: false, handler: (ctx) => healthResponse(ctx) } },
  '/api/session': {
    GET: { session: true, handler: sessionGet },
    POST: { session: false, handler: handleSignIn },
    DELETE: { session: true, handler: sessionDelete },
  },
  '/api/requests': {
    GET: { session: true, handler: (ctx) => handleQueue(ctx.viewer, ctx.request, ctx.reply) },
    POST: { session: true, handler: (ctx) => handleRaise(ctx.viewer, ctx.request, ctx.reply) },
  },
  '/api/policy': {
    GET: { session: true, handler: (ctx) => handleGetPolicy(ctx.request, ctx.reply) },
    PUT: { session: true, handler: (ctx) => handlePutPolicy(ctx.viewer, ctx.request, ctx.reply) },
  },
  '/api/policy/history': {
    GET: { session: true, handler: (ctx) => handlePolicyHistory(ctx.viewer, ctx.request, ctx.reply) },
  },
  '/api/audit': {
    GET: { session: true, handler: (ctx) => handleAudit(ctx.viewer, ctx.request, ctx.reply) },
  },
  '/api/trail.csv': {
    GET: { session: true, handler: (ctx) => handleTrailCsv(ctx.viewer, ctx.request, ctx.reply) },
  },
  '/api/trail/verify': {
    GET: { session: true, handler: (ctx) => handleTrailVerify(ctx.viewer, ctx.request, ctx.reply) },
  },
  '/api/calendar': {
    GET: { session: true, handler: (ctx) => handleCalendar(ctx.viewer, ctx.request, ctx.reply) },
  },
  '/api/share-links': {
    POST: { session: true, handler: (ctx) => handleMintShareLink(ctx.viewer, ctx.request, ctx.reply) },
  },
};

function matchApi(pathname) {
  const exact = API[pathname];
  if (exact) return { table: exact, idParam: null };
  let m;
  if ((m = pathname.match(/^\/api\/requests\/([^/]+)\/decision$/))) {
    if (!isRequestIdSegment(m[1])) return { unknownId: 'request' };
    return {
      table: { POST: { session: true, handler: (ctx) => handleDecision(ctx.viewer, Number(m[1]), ctx.request, ctx.reply) } },
      idParam: m[1],
    };
  }
  if ((m = pathname.match(/^\/api\/requests\/([^/]+)\/cancel$/))) {
    if (!isRequestIdSegment(m[1])) return { unknownId: 'request' };
    return {
      table: { POST: { session: true, handler: (ctx) => handleCancel(ctx.viewer, Number(m[1]), ctx.request, ctx.reply) } },
      idParam: m[1],
    };
  }
  if ((m = pathname.match(/^\/api\/requests\/([^/]+)$/))) {
    if (!isRequestIdSegment(m[1])) return { unknownId: 'request' };
    return {
      table: { GET: { session: true, handler: (ctx) => handleDetail(ctx.viewer, Number(m[1]), ctx.reply) } },
      idParam: m[1],
    };
  }
  if ((m = pathname.match(/^\/api\/share-links\/([^/]+)$/))) {
    if (!isRequestIdSegment(m[1])) return { unknownId: 'link' };
    return {
      table: { DELETE: { session: true, handler: (ctx) => handleRevokeShareLink(ctx.viewer, Number(m[1]), ctx.request, ctx.reply) } },
      idParam: m[1],
    };
  }
  return null;
}

function healthResponse(ctx) {
  const flags = readiness();
  const body = isReady()
    ? { status: 'ok', schema: true, seeded: true, realm: true }
    : { status: 'starting', schema: !!flags.schema, seeded: !!flags.seeded, realm: !!flags.realm };
  return respondJson(ctx.reply, isReady() ? 200 : 503, body);
}

async function sessionGet(ctx) {
  respondJson(ctx.reply, 200, {
    person: { name: ctx.viewer.name, work_address: ctx.viewer.work_address },
    role: ctx.viewer.role,
  });
}

async function sessionDelete(ctx) {
  if (ctx.token) {
    await endSessionByToken(ctx.token);
  }
  ctx.reply.clearCookie(SESSION_COOKIE, { path: '/' });
  ctx.reply.status(204);
  ctx.reply.send();
}

function respondJson(reply, status, body, extraHeaders = {}) {
  reply.status(status);
  for (const [k, v] of Object.entries(extraHeaders)) reply.header(k, v);
  reply.header('content-type', 'application/json; charset=utf-8');
  reply.send(body);
}

// ---------------------------------------------------------------------------
// Body handling
// ---------------------------------------------------------------------------

function parseBody(raw, contentType) {
  if (raw === undefined || raw === null || raw === '') return {};
  const bytes = typeof raw === 'string' ? Buffer.byteLength(raw, 'utf8') : raw.length;
  if (bytes > 65536) throw new ApiError(413, 'Request body is too large.');
  const ct = (contentType || '').split(';')[0].trim().toLowerCase();
  if (ct !== 'application/json') throw new ApiError(400, 'Send the body as application/json.');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiError(400, 'The body must be a JSON object.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ApiError(400, 'The body must be a JSON object.');
  }
  if (depth(parsed) > 8) throw new ApiError(400, 'The body must be a JSON object.');
  return parsed;
}

function depth(value, level = 1) {
  if (level > 8) return level;
  if (value === null || typeof value !== 'object') return level;
  let max = level;
  for (const v of Object.values(value)) {
    const d = depth(v, level + 1);
    if (d > max) max = d;
  }
  return max;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export async function createServer() {
  const app = Fastify({ logger: false });

  await app.register(cookie);

  // production build assets served from the desk's own origin: fonts, styles
  // and scripts from build/client/assets, and nothing else
  const assetsDir = path.join(process.cwd(), 'build/client/assets');
  const ASSET_TYPES = {
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.woff2': 'font/woff2',
    '.json': 'application/json; charset=utf-8',
  };
  app.route({
    method: ['GET', 'HEAD'],
    url: '/assets/*',
    handler: async (request, reply) => {
      const name = request.params['*'];
      if (!/^[\w][\w.-]*$/.test(name) || name.includes('..')) {
        reply.status(404);
        reply.send();
        return;
      }
      const type = ASSET_TYPES[path.extname(name)];
      if (!type) {
        reply.status(404);
        reply.send();
        return;
      }
      let body;
      try {
        body = await readFile(path.join(assetsDir, name));
      } catch {
        reply.status(404);
        reply.send();
        return;
      }
      reply.header('content-type', type);
      reply.header('cache-control', 'public, max-age=3600');
      reply.status(200);
      reply.send(body);
    },
  });

  // raw bodies: we parse them ourselves to control size and depth
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    done(null, body);
  });
  app.addContentTypeParser('*', (req, payload, done) => {
    const chunks = [];
    payload.on('data', (c) => chunks.push(c));
    payload.on('end', () => done(null, Buffer.concat(chunks)));
    payload.on('error', () => done(new Error('stream error'), undefined));
  });

  // security headers on every answer, and no X-Powered-By
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    // the shared month never leaks its token to another page
    reply.header('referrer-policy', request.url.startsWith('/share/') ? 'no-referrer' : 'strict-origin-when-cross-origin');
    return payload;
  });

  // ---- API routes ----
  app.route({
    method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
    url: '/api/*',
    handler: async (request, reply) => apiDispatch(request, reply),
  });

  // ---- pages: React Router SSR ----
  let rrHandler = null;
  try {
    const build = await import('./server/index.js');
    rrHandler = createRequestHandler(build);
  } catch {
    rrHandler = null;
  }

  app.setNotFoundHandler(async (request, reply) => {
    if (rrHandler) {
      const res = await rrHandler(toWebRequest(request));
      await sendWebResponse(reply, res);
      return reply;
    }
    reply.status(500).send('not built');
  });

  return app;
}

async function apiDispatch(request, reply) {
  const url = new URL(request.url, 'http://internal');
  const pathname = url.pathname;
  const match = matchApi(pathname);

  // shared-link write refusal
  const carriesShareToken = pathname.startsWith('/share/') || url.searchParams.has('share');
  if (carriesShareToken && request.method !== 'GET' && request.method !== 'HEAD') {
    return respondJson(reply, 403, { error: 'A shared link is read-only.' });
  }

  if (!match || match.notFound) {
    return respondJson(reply, 404, { error: 'No such endpoint.' });
  }
  if (match.unknownId === 'request') {
    return respondJson(reply, 404, { error: 'No such request.' });
  }
  if (match.unknownId === 'link') {
    return respondJson(reply, 404, { error: 'No such link.' });
  }
  const method = request.method === 'HEAD' ? 'GET' : request.method;
  const entry = match.table[method];
  if (!entry) {
    const allow = Object.keys(match.table);
    if (match.table.GET) allow.push('HEAD');
    reply.header('allow', allow.join(', '));
    return respondJson(reply, 405, { error: 'Method not allowed.' });
  }

  let body = {};
  try {
    const raw = request.body;
    if (raw !== undefined && raw !== null && (!Buffer.isBuffer(raw) || raw.length > 0)) {
      body = parseBody(Buffer.isBuffer(raw) ? raw.toString('utf8') : raw, request.headers['content-type']);
    }
  } catch (err) {
    if (err instanceof ApiError) return respondJson(reply, err.status, apiErrorBody(err));
    throw err;
  }
  request.body = body;

  // session
  let ctx = { request, reply, viewer: null, token: null };
  if (entry.session) {
    const resolved = await resolveViewer(request);
    ctx.token = resolved.token;
    if (resolved.state === 'none') {
      return respondJson(reply, 401, { error: 'Sign in to continue.' });
    }
    if (resolved.state === 'ended') {
      return respondJson(reply, 401, { error: 'Your session has ended. Sign in again.' });
    }
    ctx.viewer = resolved.viewer;
  }

  try {
    await entry.handler(ctx);
  } catch (err) {
    if (err instanceof ApiError) {
      const headers = {};
      if (err.retryAfter !== undefined) headers['retry-after'] = String(err.retryAfter);
      return respondJson(reply, err.status, apiErrorBody(err), headers);
    }
    console.error('[api]', err?.stack || err);
    return respondJson(reply, 500, { error: 'The desk could not complete that. Try again.' });
  }
}

function apiErrorBody(err) {
  const body = { error: err.error };
  if (err.field !== undefined) body.field = err.field;
  if (err.decided_by !== undefined) {
    body.decided_by = err.decided_by;
    body.decided_at = err.decided_at;
  }
  return body;
}

function toWebRequest(request) {
  const url = `http://${request.headers.host || 'localhost'}${request.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(request.headers)) {
    if (Array.isArray(v)) v.forEach((item) => headers.append(k, item));
    else if (v !== undefined) headers.set(k, String(v));
  }
  const method = request.method;
  let body;
  if (method === 'GET' || method === 'HEAD') body = undefined;
  else if (Buffer.isBuffer(request.body)) body = request.body;
  return new Request(url, { method, headers, body });
}

async function sendWebResponse(reply, res) {
  reply.status(res.status);
  res.headers.forEach((value, key) => {
    if (key !== 'content-length' || !res.body) reply.header(key, value);
  });
  if (res.body) {
    const buffer = Buffer.from(await res.arrayBuffer());
    reply.send(buffer);
  } else {
    reply.send();
  }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const app = await createServer();
  const port = config.publicPort;
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`Rostara listening on ${port}`);

  const retry = setInterval(async () => {
    try {
      await tick(fetch);
    } catch {
      // keep trying
    }
  }, 3000);

  // initial tick immediately, then wait for readiness in the background
  tick(fetch).catch(() => {});
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error('server failed to start', err);
    process.exit(1);
  });
}
