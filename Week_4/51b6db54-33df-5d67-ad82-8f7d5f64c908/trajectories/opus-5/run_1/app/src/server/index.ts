import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SETTINGS, type Settings } from '../shared/format.js';
import type { NumberFormat, TimeZone } from '../shared/types.js';
import { loadClock, now } from './clock.js';
import { config } from './config.js';
import { DatabaseUnavailable, keepTryingSchema, one } from './db.js';
import { ensureDemoWorkspace } from './demo.js';
import { ApiError, databaseUnavailable } from './errors.js';
import {
  bodyLimitFor,
  checkOrigin,
  compileRoutes,
  makeFormatters,
  matchRoute,
  parseCookies,
  parseJsonBody,
  readBody,
  sendJson,
  SESSION_COOKIE,
  type Ctx,
  type Person,
  type Reply,
  type Route,
} from './http.js';
import { startJobWorker } from './jobs.js';
import { startClockWork } from './clockwork.js';
import { startHeartbeat } from './live.js';
import { startMailWorker } from './mail.js';
import { authRoutes } from './routes/auth.js';
import { commentRoutes } from './routes/comments.js';
import { drawingRoutes } from './routes/drawing.js';
import { linkRoutes, shareGuard } from './routes/links.js';
import { mediaRoutes } from './routes/media.js';
import { paletteRoutes } from './routes/palette.js';
import { platformRoutes } from './routes/platform.js';
import { projectRoutes } from './routes/projects.js';
import { spriteRoutes } from './routes/sprites.js';
import { tileRoutes } from './routes/tiles.js';
import { ensureBucket } from './storage.js';

const routes: Route[] = [
  ...platformRoutes,
  ...authRoutes,
  ...projectRoutes,
  ...spriteRoutes,
  ...drawingRoutes,
  ...paletteRoutes,
  ...tileRoutes,
  ...commentRoutes,
  ...mediaRoutes,
  ...shareGuard,
  ...linkRoutes,
];
const compiled = compileRoutes(routes);

const webRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'web');

const PAGE_PATHS = [
  /^\/$/,
  /^\/signup$/,
  /^\/signin$/,
  /^\/projects$/,
  /^\/projects\/\d+$/,
  /^\/projects\/\d+\/sprites\/\d+$/,
  /^\/invites\/[^/]+$/,
  /^\/s\/[^/]+$/,
];

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

async function personFromCookie(req: IncomingMessage): Promise<Person | null> {
  const cookies = parseCookies(req.headers.cookie);
  const session = cookies[SESSION_COOKIE];
  if (session === undefined) return null;
  return one<Person>(
    `SELECT u.id, u.email, u.name, u.number_format, u.time_zone
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1`,
    [session],
  );
}

async function serveStatic(path: string, res: ServerResponse): Promise<void> {
  const wanted = path === '/' || PAGE_PATHS.some((page) => page.test(path)) ? '/index.html' : path;
  const safe = normalize(wanted).replace(/^(\.\.[/\\])+/, '');
  const file = join(webRoot, safe);
  if (!file.startsWith(webRoot)) {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }
  try {
    const bytes = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'content-length': bytes.length,
      'x-content-type-options': 'nosniff',
      'cache-control': extname(file) === '.html' ? 'no-store' : 'public, max-age=300',
    });
    res.end(bytes);
  } catch {
    sendJson(res, 404, { error: 'not_found' });
  }
}

function settingsOf(person: Person | null): Settings {
  if (person === null) return DEFAULT_SETTINGS;
  return {
    number_format: (person.number_format ?? 'en-US') as NumberFormat,
    time_zone: (person.time_zone ?? 'UTC') as TimeZone,
  };
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const method = req.method ?? 'GET';
  if (!url.pathname.startsWith('/api/')) {
    await serveStatic(url.pathname, res);
    return;
  }

  const found = matchRoute(compiled, method, url.pathname);
  if (found === null) {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }

  const cookies: string[] = [];
  try {
    checkOrigin(req, method);
    const raw = found.route.raw === true ? Buffer.alloc(0) : await readBody(req, bodyLimitFor(url.pathname));
    const body = found.route.raw === true
      ? {}
      : parseJsonBody(raw, String(req.headers['content-type'] ?? ''), method);
    const health = url.pathname === '/api/health';
    const person = health ? null : await personFromCookie(req);
    const settings = settingsOf(person);
    const ctx: Ctx = {
      req,
      res,
      method,
      path: url.pathname,
      url,
      params: found.params,
      body,
      raw,
      person,
      settings,
      now: health ? new Date() : await now(),
      ...makeFormatters(settings),
      setCookie: (value: string) => cookies.push(value),
    };
    const reply = (await found.route.handler(ctx)) as Reply | void;
    if (reply === undefined) return;
    const headers: Record<string, string> = { ...(reply.headers ?? {}) };
    if (cookies.length > 0) res.setHeader('set-cookie', cookies);
    if (reply.bytes !== undefined) {
      res.writeHead(reply.status, {
        'content-length': reply.bytes.length,
        'x-content-type-options': 'nosniff',
        ...headers,
      });
      res.end(reply.bytes);
      return;
    }
    if (reply.status === 204) {
      res.writeHead(204, headers);
      res.end();
      return;
    }
    sendJson(res, reply.status, reply.body, headers);
  } catch (error) {
    if (cookies.length > 0) res.setHeader('set-cookie', cookies);
    if (error instanceof ApiError) {
      sendJson(res, error.status, error.body);
      return;
    }
    if (error instanceof DatabaseUnavailable) {
      const failure = databaseUnavailable();
      sendJson(res, failure.status, failure.body);
      return;
    }
    process.stderr.write(`${method} ${url.pathname} failed: ${String(error)}\n`);
    sendJson(res, 500, { error: 'server_error' });
  }
}

async function start(): Promise<void> {
  const server = createServer((req, res) => {
    void handle(req, res);
  });
  server.keepAliveTimeout = 65000;
  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`celmate listening on ${config.port}\n`);
  });

  startHeartbeat();
  await keepTryingSchema();
  await loadClock();
  try {
    await ensureBucket();
  } catch {
    /* storage may be away; drawing carries on */
  }
  try {
    await ensureDemoWorkspace();
  } catch (error) {
    process.stderr.write(`demo seed skipped: ${String(error)}\n`);
  }
  startMailWorker();
  startJobWorker();
  startClockWork();
}

void start();
