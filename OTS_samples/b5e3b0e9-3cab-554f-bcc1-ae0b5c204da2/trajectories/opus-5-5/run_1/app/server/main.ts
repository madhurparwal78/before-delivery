import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { config, timers, today } from './config.js';
import { schoolOf, userFromCookies } from './auth.js';
import { connectWithRetry, databaseUnavailable, isReady, one } from './db.js';
import { ApiError, type Ctx, JSON_LIMIT, makeBodyReader, ok, parseCookies, Router, send } from './http.js';
import { loadSession, resumeRunningSessions } from './live.js';
import { registerAccountRoutes } from './routes/accounts.js';
import { registerGradingRoutes } from './routes/grading.js';
import { registerLibraryRoutes, seedBuiltIns } from './routes/library.js';
import { registerRecordRoutes } from './routes/records.js';
import { registerSessionRoutes } from './routes/sessions.js';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), 'public');

const router = new Router();
router.add('GET', '/api/health', async () => ok({ status: 'ok' }));
router.add('GET', '/api/config', async () =>
  ok({ today: today(), timeZone: config.timeZone, simClock: config.simClock, timers }),
);
registerAccountRoutes(router);
registerLibraryRoutes(router);
registerSessionRoutes(router);
registerRecordRoutes(router);
registerGradingRoutes(router);

const OPEN_PAGES = [/^\/$/, /^\/signup$/, /^\/signin$/, /^\/verify$/, /^\/invite\/[^/]+$/];
const SIGNED_IN_PAGES = [
  /^\/classes\/[^/]+$/,
  /^\/aerodromes$/,
  /^\/aerodromes\/[^/]+$/,
  /^\/scenarios\/new$/,
  /^\/scenarios\/[^/]+$/,
  /^\/sessions\/[^/]+$/,
  /^\/sessions\/[^/]+\/debrief$/,
  /^\/records\/[^/]+$/,
  /^\/settings$/,
];

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.html': 'text/html; charset=utf-8',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
};

async function servePage(res: ServerResponse, status: number): Promise<void> {
  const html = await readFile(join(publicDir, 'index.html'));
  send(res, { status, body: html, headers: { ...SECURITY_HEADERS, 'Content-Type': CONTENT_TYPES['.html']! } });
}

async function handleStatic(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, { status: 404, json: { error: 'not_found' } });
    return;
  }
  if (path.startsWith('/assets/')) {
    const file = normalize(join(publicDir, path));
    if (file.startsWith(join(publicDir, 'assets')) && CONTENT_TYPES[extname(file)]) {
      try {
        const body = await readFile(file);
        send(res, {
          status: 200,
          body,
          headers: { ...SECURITY_HEADERS, 'Content-Type': CONTENT_TYPES[extname(file)]!, 'Cache-Control': 'no-cache' },
        });
        return;
      } catch {
        // falls through to the not-found page
      }
    }
    await servePage(res, 404);
    return;
  }
  if (OPEN_PAGES.some((page) => page.test(path))) {
    await servePage(res, 200);
    return;
  }
  if (SIGNED_IN_PAGES.some((page) => page.test(path))) {
    let signedIn = true;
    if (isReady()) {
      try {
        signedIn = (await userFromCookies(parseCookies(req.headers.cookie))) !== null;
      } catch {
        signedIn = true;
      }
    }
    if (!signedIn) {
      res.writeHead(302, { Location: `/signin?next=${encodeURIComponent(path)}`, 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    await servePage(res, 200);
    return;
  }
  await servePage(res, 404);
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const path = url.pathname;
  const matched = router.match(req.method ?? 'GET', path);
  if (!matched) {
    send(res, { status: 404, json: { error: 'not_found' } });
    return;
  }
  const readBody = makeBodyReader(req);
  const ctx: Ctx = {
    req,
    params: matched.params,
    query: url.searchParams,
    cookies: parseCookies(req.headers.cookie),
    readBody,
    json: async (limit = JSON_LIMIT) => {
      const raw = (await readBody(limit)).toString('utf8');
      if (!raw.trim()) return {};
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new ApiError(422, { errors: { body: 'Send a JSON object.' } });
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new ApiError(422, { errors: { body: 'Send a JSON object.' } });
      }
      return parsed as Record<string, unknown>;
    },
  };
  try {
    if (path !== '/api/health' && path !== '/api/config' && !isReady()) throw databaseUnavailable();
    send(res, await matched.handler(ctx));
  } catch (error) {
    if (error instanceof ApiError) {
      send(res, { status: error.status, json: error.body });
      if (error.status === 413) req.resume();
      return;
    }
    console.error(error);
    send(res, { status: 500, json: { error: 'server_error', message: 'Something went wrong. Try again.' } });
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const work = url.pathname.startsWith('/api/') ? handleApi(req, res, url) : handleStatic(req, res, url.pathname);
  work.catch((error: unknown) => {
    console.error(error);
    if (!res.headersSent) send(res, { status: 500, json: { error: 'server_error', message: 'Something went wrong. Try again.' } });
  });
});

const sockets = new WebSocketServer({ noServer: true });

function refuseUpgrade(socket: Duplex, status: number): void {
  socket.write(`HTTP/1.1 ${status} ${status === 403 ? 'Forbidden' : 'Not Found'}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  const allowed = new Set([`http://${req.headers.host}`, `https://${req.headers.host}`, new URL(config.publicUrl).origin]);
  return allowed.has(origin);
}

server.on('upgrade', (req, socket, head) => {
  void (async () => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const match = /^\/api\/sessions\/([^/]+)\/live$/.exec(url.pathname);
    if (!match || !isReady()) return refuseUpgrade(socket, 404);
    if (!sameOrigin(req)) return refuseUpgrade(socket, 403);
    const user = await userFromCookies(parseCookies(req.headers.cookie));
    const session = await loadSession(decodeURIComponent(match[1]!));
    if (!user || !session) return refuseUpgrade(socket, 404);
    const school = await schoolOf(user.id);
    const member =
      school?.id === session.schoolId ||
      (await one(
        'SELECT 1 FROM class_students cs JOIN classes c ON c.id = cs.class_id WHERE cs.user_id = $1 AND c.school_id = $2',
        [user.id, session.schoolId],
      ));
    if (!member) return refuseUpgrade(socket, 404);
    sockets.handleUpgrade(req, socket, head, (ws) => {
      const client = { socket: ws, userId: user.id };
      session.connect(client);
      ws.on('close', () => session.disconnect(client));
      ws.on('error', () => ws.close());
    });
  })().catch(() => refuseUpgrade(socket, 404));
});

server.listen(config.port, '0.0.0.0', () => {
  console.log(`Runup Bay listening on 0.0.0.0:${config.port}`);
});

void connectWithRetry(async () => {
  await seedBuiltIns();
  await resumeRunningSessions();
});
