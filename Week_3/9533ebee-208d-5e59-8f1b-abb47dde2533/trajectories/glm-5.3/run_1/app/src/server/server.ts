import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { boot } from './app.js';
import { getConfig } from './config.js';
import { Ctx, Actor, Body, MAX_BODY_BYTES, sendProblem, sendJson } from './http.js';
import { problem, ProblemError } from './problems.js';
import { handleApi } from './api.js';
import { validKey, beginKeyed, releaseKey } from './idempotency.js';
import { startPolling } from './oracle.js';
import { startJobs } from './jobs.js';
import type { FontFaces } from './statements.js';
import type { App } from './app.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
  '.webmanifest': 'application/manifest+json',
};

const app: App = { db: undefined as unknown as App['db'], store: undefined as unknown as App['store'], ready: false };
let fonts: FontFaces = {
  mono: { name: 'PlexMono', file: 'IBMPlexMono-Regular.woff2', fileBold: 'IBMPlexMono-Bold.woff2' },
  sans: { name: 'PlexSans', file: 'IBMPlexSans-Regular.woff2', fileBold: 'IBMPlexSans-Bold.woff2' },
  grotesk: { name: 'SpaceGrotesk', file: 'SpaceGrotesk-Regular.woff2', fileBold: 'SpaceGrotesk-Bold.woff2' },
};

async function main(): Promise<void> {
  const cfg = getConfig();
  const server = http.createServer((req, res): void => {
    void handle(req, res).catch((err): void => {
      if (!(err instanceof ProblemError)) {
        console.error('unexpected error:', err);
      }
      const problemErr = err instanceof ProblemError ? err : problem(500, 'internal_error', 'Something went wrong on our side \u2013 nothing is confirmed.');
      if (!res.headersSent) sendProblem(res, problemErr);
      else res.end();
    });
  });
  server.listen(cfg.port, '0.0.0.0', (): void => {
    process.stdout.write(`quillmoor-reserve listening on ${cfg.port}\n`);
  });
  // The schema is applied in the background: while Postgres is unreachable the
  // health check answers `starting` and the server keeps retrying every 2 seconds.
  const booted = await boot();
  app.db = booted.db;
  app.store = booted.store;
  app.ready = true;
  startPolling(app);
  startJobs(app, fonts);
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;
  const method = (req.method ?? 'GET').toUpperCase();

  if (path === '/api/health') {
    if (app.ready) sendJson(res, 200, { status: 'ok' });
    else sendJson(res, 503, { status: 'starting' });
    return;
  }

  if (path.startsWith('/api/')) {
    await handleApiRequest(req, res, url, method);
    return;
  }

  serveStatic(req, res, path, method);
}

const NEVER_SERVED = /^\/(?:\.[^/]*|package(?:-lock)?\.json|tsconfig[^/]*\.json|run\.json|THIRD_PARTY_NOTICES\.md|node_modules\/|src\/|dist\/|scripts\/)/;

/** Source, environment, lockfiles and manifests are never served. */
function isNeverServed(relative: string): boolean {
  return NEVER_SERVED.test(relative);
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, path: string, method: string): void {
  if (method !== 'GET' && method !== 'HEAD') {
    sendProblem(res, problem(404, 'not_found', 'Nothing here by that name.'));
    return;
  }
  const root = join(process.cwd(), 'public');
  let relative = normalize(decodeURIComponent(path));
  if (relative === '/' || relative === '') relative = '/index.html';
  const target = join(root, relative);
  if (!target.startsWith(root)) {
    sendProblem(res, problem(404, 'not_found', 'Nothing here by that name.'));
    return;
  }
  if (isNeverServed(relative)) {
    sendProblem(res, problem(404, 'not_found', 'Nothing here by that name.'));
    return;
  }
  const ext = extname(target);
  if (ext !== '' && !Object.prototype.hasOwnProperty.call(MIME, ext)) {
    sendProblem(res, problem(404, 'not_found', 'Nothing here by that name.'));
    return;
  }
  if (existsSync(target) && statSync(target).isFile()) {
    const bytes = readFileSync(target);
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Content-Length': bytes.length,
      'Cache-Control': 'no-store',
    });
    res.end(method === 'HEAD' ? undefined : bytes);
    return;
  }
  if (ext !== '') {
    sendProblem(res, problem(404, 'not_found', 'Nothing here by that name.'));
    return;
  }
  const index = join(root, 'index.html');
  if (existsSync(index)) {
    const bytes = readFileSync(index);
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Content-Length': bytes.length, 'Cache-Control': 'no-store' });
    res.end(method === 'HEAD' ? undefined : bytes);
    return;
  }
  sendProblem(res, problem(404, 'not_found', 'Nothing here by that name.'));
}

async function handleApiRequest(req: http.IncomingMessage, res: http.ServerResponse, url: URL, method: string): Promise<void> {
  if (!app.ready) {
    sendProblem(res, problem(503, 'ledger_unavailable', 'The ledger is unreachable \u2013 nothing is confirmed. Try again shortly.'));
    return;
  }
  const origin = req.headers.origin;
  const host = req.headers.host ?? '';
  const unsafe = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method);
  let body: unknown;
  if (unsafe) {
    const raw = await readBody(req);
    if (raw.tooLarge) {
      sendProblem(res, problem(413, 'payload_too_large', 'The request body is too large.'));
      return;
    }
    if (origin !== undefined && origin !== `http://${host}` && origin !== `https://${host}`) {
      sendProblem(res, problem(403, 'cross_origin', 'Requests must come from Quillmoor\u2019s own pages.'));
      return;
    }
    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.toLowerCase().startsWith('application/json')) {
      sendProblem(res, problem(415, 'unsupported_media_type', 'Send the body as application/json.'));
      return;
    }
    if (raw.buffer.length > 0) {
      try {
        body = JSON.parse(raw.buffer.toString('utf8'));
      } catch {
        sendProblem(res, problem(400, 'invalid_json', 'The request body is not valid JSON.'));
        return;
      }
    } else {
      body = {};
    }
  }
  const ctx: Ctx = {
    req, res, method, path: url.pathname, query: url.searchParams, params: {},
  };
  const auth = req.headers.authorization;
  if (auth !== undefined && auth.startsWith('Bearer ')) {
    const token = auth.slice('Bearer '.length);
    const actor = await resolveActor(token);
    if (actor === null) {
      sendProblem(res, problem(401, 'unauthenticated', 'Choose who you are acting as.', undefined, { 'WWW-Authenticate': 'Bearer' }));
      return;
    }
    ctx.actor = actor;
  }
  const pathWithoutId = endpointKey(url.pathname);
  const idempotencyKey = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : undefined;
  const ifMatch = typeof req.headers['if-match'] === 'string' ? req.headers['if-match'] : undefined;
  ctx.body = body as Body;
  ctx.ifMatch = ifMatch;
  ctx.idempotencyKey = idempotencyKey;
  if (isKeyedPath(url.pathname, method)) {
    if (idempotencyKey === undefined || !validKey(idempotencyKey)) {
      sendProblem(res, problem(400, 'idempotency_key_required', 'Send an Idempotency-Key header of 1 to 128 visible characters.'));
      return;
    }
    if (ctx.actor !== undefined) {
      const stored = await beginKeyed(app.db, ctx.actor.actor_id, pathWithoutId, idempotencyKey, body);
      if (stored !== null) {
        sendJson(res, stored.status, stored.body, { 'Idempotency-Replayed': 'true' });
        return;
      }
    }
  }
  let result;
  try {
    result = await handleApi(ctx, app);
  } catch (err) {
    if (err instanceof ProblemError) {
      if (err.status >= 500 && isKeyedPath(url.pathname, method) && ctx.actor !== undefined && idempotencyKey !== undefined) {
        await releaseKey(app.db, ctx.actor.actor_id, pathWithoutId, idempotencyKey);
      }
      sendProblem(res, err);
      return;
    }
    if ((err as { status?: number }).status !== undefined) {
      sendProblem(res, err as ProblemError);
      return;
    }
    throw err;
  }
  const headers: Record<string, string> = { ...(result.headers ?? {}) };
  const payload = result.body;
  if (result.raw === true) {
    const bytes = payload as Uint8Array;
    res.writeHead(result.status, {
      'Content-Type': headers['Content-Type'] ?? 'application/pdf',
      'Content-Length': bytes.length,
    });
    res.end(bytes);
    return;
  }
  sendJson(res, result.status, payload, headers);
}

function endpointKey(pathname: string): string {
  const match = /^\/api\/positions\/([^/]+)\/(draws|repayments|collateral|collateral-withdrawals|liquidations)$/.exec(pathname);
  if (match !== null) return `/api/positions/:id/${match[2]}`;
  const poolMatch = /^\/api\/pools\/([^/]+)\/(supplies|withdrawals)$/.exec(pathname);
  if (poolMatch !== null) return `/api/pools/:asset/${poolMatch[2]}`;
  return pathname;
}

function isKeyedPath(pathname: string, method: string): boolean {
  if (method !== 'POST') return false;
  return /^\/api\/positions\/[^/]+\/draws$/.test(pathname)
    || /^\/api\/positions\/[^/]+\/liquidations$/.test(pathname)
    || /^\/api\/pools\/[^/]+\/withdrawals$/.test(pathname)
    || pathname === '/api/swaps';
}

async function readBody(req: http.IncomingMessage): Promise<{ buffer: Buffer; tooLarge: boolean }> {
  return new Promise((resolve, reject): void => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer): void => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        req.removeAllListeners('data');
        resolve({ buffer: Buffer.alloc(0), tooLarge: true });
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', (): void => resolve({ buffer: Buffer.concat(chunks), tooLarge }));
    req.on('error', reject);
  });
}

async function resolveActor(token: string): Promise<Actor | null> {
  if (app.db === undefined) return null;
  return app.db.withClient(async (client): Promise<Actor | null> => {
    const result = await client.query<{ actor_id: string; name: string; email: string; role: Actor['role'] }>(
      `SELECT m.actor_id, m.name, m.email, m.role FROM sessions s JOIN members m ON m.actor_id = s.actor_id WHERE s.token = $1`,
      [token],
    );
    return result.rows[0] ?? null;
  }).catch((): null => null);
}

main().catch((err): void => {
  console.error(err);
  process.exit(1);
});
