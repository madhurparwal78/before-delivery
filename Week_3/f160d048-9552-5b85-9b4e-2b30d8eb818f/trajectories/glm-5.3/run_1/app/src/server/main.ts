// The single server: API routes, the live stream, static assets and the SPA.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { config } from '../lib/config.js';
import { App } from '../lib/app.js';
import { userFromSession, SESSION_COOKIE } from '../lib/sessions.js';
import { errors } from '../lib/errors.js';
import { sendError, sendJson, readJsonBody, JSON_HEADERS, type Route, type RouteContext } from './http.js';
import { migrateAndSeed, seedFounder } from './seed.js';
import { accountRoutes } from './routes-accounts.js';
import { routes as postRoutes } from './routes-posts.js';
import { routes as jobRoutes } from './routes-jobs.js';
import { routes as miscRoutes } from './routes-misc.js';
import { startJobLoop, runDueJobs } from './jobs.js';
import { ensureIndexes, syncAllFromPostgres } from './search.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const INDEX_HTML = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
const NOT_FOUND_HTML = INDEX_HTML.replace(
  '<title>Candour Bench</title>',
  '<title>Page not found - Candour Bench</title>',
);

const routes: Route[] = [...accountRoutes, ...postRoutes, ...jobRoutes, ...miscRoutes];

function matchRoute(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    const source = candidate.path;
    const names: string[] = [];
    const regex = new RegExp(
      '^' +
        source.replace(/:[a-zA-Z_]+/g, (match) => {
          names.push(match.slice(1));
          return '([^/]+)';
        }) +
        '$',
    );
    const match = pathname.match(regex);
    if (!match) continue;
    const params: Record<string, string> = {};
    names.forEach((name, index) => {
      params[name] = decodeURIComponent(match[index + 1]);
    });
    return { route: candidate, params };
  }
  return null;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

function authAllows(user: { role: string } | null, level: Route['auth']): boolean {
  if (!level) return true;
  if (!user) return false;
  switch (level) {
    case 'member':
      return true;
    case 'moderator':
      return user.role === 'moderator' || user.role === 'founder';
    case 'team':
      return user.role === 'employer_admin' || user.role === 'recruiter';
    case 'employerAdmin':
      return user.role === 'employer_admin';
    case 'founder':
      return user.role === 'founder';
  }
}

function cookieToken(req: http.IncomingMessage): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return rest.join('=');
  }
  return null;
}

export async function startServer(): Promise<void> {
  const cfg = config();
  const app = new App();

  // PostgreSQL is required: retry every 2 seconds until it connects.
  for (;;) {
    try {
      await app.db.query('select 1');
      break;
    } catch (err) {
      console.error('database not ready', String(err));
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  await migrateAndSeed(app);
  await app.loadClock();
  if (cfg.founderEmail && cfg.founderPassword) {
    await seedFounder(app, cfg.founderEmail, cfg.founderPassword);
  }
  void ensureIndexes()
    .then(() => syncAllFromPostgres(app))
    .catch((err) => console.error('search sync at start', String(err)));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;
    try {
      const origin = req.headers.origin;
      if (origin !== undefined) {
        let sameOrigin = false;
        try {
          const originUrl = new URL(origin);
          const host = req.headers.host ?? '';
          sameOrigin = originUrl.host === host;
        } catch {
          sameOrigin = false;
        }
        if (!sameOrigin && req.method !== 'GET' && req.method !== 'HEAD' && pathname.startsWith('/api/')) {
          res.writeHead(403, JSON_HEADERS);
          res.end(JSON.stringify({ error: 'forbidden', message: 'Your account cannot do that.' }));
          return;
        }
      }
      if (pathname === '/api/live' && req.method === 'GET') {
        await handleLive(req, res, app);
        return;
      }
      if (pathname.startsWith('/api/') || pathname === '/health') {
        const matched = matchRoute(req.method ?? 'GET', pathname);
        if (!matched) throw errors.notFound();
        const user = await userFromSession(app, cookieToken(req));
        if (matched.route.auth && !authAllows(user, matched.route.auth)) {
          throw user ? errors.forbidden() : errors.unauthenticated();
        }
        const isApply = req.method === 'POST' && /^\/api\/jobs\/[^/]+\/applications$/.test(pathname);
        const isMark = req.method === 'PUT' && pathname === '/api/employer/company/mark';
        if ((req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') && !isApply && !isMark) {
          const body = await readJsonBody(req, 65536);
          (req as unknown as { body: unknown }).body = body;
        }
        const ctx: RouteContext = {
          req,
          res,
          app,
          url,
          user,
          body: (req as unknown as { body: unknown }).body,
          params: matched.params,
        };
        await matched.route.handler(ctx);
        return;
      }
      serveStatic(req, res, pathname);
    } catch (err) {
      sendError(res, err);
    }
  });

  server.listen(cfg.port, '0.0.0.0', () => {
    console.log(`candour bench serving on 0.0.0.0:${cfg.port}`);
  });
  startJobLoop(app);
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Method not allowed');
    return;
  }
  if (pathname === '/' || isPagePath(pathname)) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
    res.end(INDEX_HTML);
    return;
  }
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(NOT_FOUND_HTML);
    return;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(NOT_FOUND_HTML);
    return;
  }
  const ext = path.extname(filePath);
  const mime = MIME[ext] ?? 'application/octet-stream';
  const data = fs.readFileSync(filePath);
  res.writeHead(200, { 'content-type': mime, 'content-length': String(data.length), 'cache-control': 'no-cache' });
  res.end(data);
}

function isPagePath(pathname: string): boolean {
  if (pathname.startsWith('/fonts/') || pathname.startsWith('/assets/')) return false;
  if (path.extname(pathname)) return false;
  return true;
}

// SSE stream: hello, replayed events and live events, filtered per viewer.
async function handleLive(req: http.IncomingMessage, res: http.ServerResponse, app: App): Promise<void> {
  const user = await userFromSession(app, cookieToken(req)).catch(() => null);
  const lastEventId = req.headers['last-event-id'];
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  const write = (text: string): void => {
    if (!res.writableEnded) res.write(text);
  };
  write('retry: 1000\n');
  const visibleTo = (data: Record<string, unknown>): boolean => {
    const type = data.event_type as string | undefined;
    const eventType = data.type as string | undefined;
    void type;
    void eventType;
    return true;
  };
  void visibleTo;
  const hello = (replay: string): void => {
    write(`event: hello\ndata: {"replay":"${replay}"}\n\n`);
  };
  const sendEvent = (id: number, eventName: string, data: Record<string, unknown>): void => {
    write(`event: ${eventName}\nid: ${id}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const filter = (event: { type: string; data: Record<string, unknown> }): boolean => {
    switch (event.type) {
      case 'queue.changed':
      case 'queue.history':
        return user?.role === 'moderator' || user?.role === 'founder';
      case 'post.state': {
        return user !== null && event.data.author === user.id;
      }
      case 'member.unlocked':
        return user !== null && event.data.member === user.id;
      case 'company.changed':
        return true;
      case 'application.stage': {
        if (!user) return false;
        if (event.data.team === user.company_slug) return true;
        const candidateId = event.data.candidate as string | null;
        return candidateId === user.id;
      }
      case 'channel.post':
        return user?.role === 'member';
      case 'alert.matched':
        return user !== null && event.data.owner === user.id;
      default:
        return false;
    }
  };
  const clientId = crypto.randomUUID();
  // Live events flow once hello has been written; a replay changes only the hello text.
  let ready = false;
  if (typeof lastEventId === 'string' && lastEventId.length > 0) {
    const wanted = Number.parseInt(lastEventId, 10);
    const oldest = app.live.oldestKeptId();
    if (Number.isFinite(wanted) && oldest !== null && wanted >= oldest) {
      for (const event of app.live.replayAfter(wanted, filter)) {
        sendEvent(event.id!, event.type, event.data);
      }
      hello('complete');
      ready = true;
    }
  }
  if (!ready) {
    hello('reload');
  }
  ready = true;
  app.live.subscribe({
    id: clientId,
    send: (event) => {
      if (event.type === 'close') {
        res.end();
        return true;
      }
      if (!filter(event)) return true;
      if (!ready) return true;
      if (event.id === undefined) return true;
      sendEvent(event.id, event.type, event.data);
      return true;
    },
    filter,
  });
  const comment = setInterval(() => {
    write(': keep-alive\n\n');
  }, 15000);
  req.on('close', () => {
    clearInterval(comment);
    app.live.unsubscribe(clientId);
  });
}
