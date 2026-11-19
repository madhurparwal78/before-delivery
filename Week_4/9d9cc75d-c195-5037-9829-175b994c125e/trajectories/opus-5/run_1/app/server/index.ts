import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { dbReady, initDb } from './db.js';
import { userForSession } from './auth.js';
import {
  ApiError,
  JSON_LIMIT,
  parseCookies,
  readBody,
  Router,
  sendError,
  sendJson,
  type Ctx,
  type SessionUser,
} from './http.js';
import { registerPlatform } from './routes/platform.js';
import { registerAccounts } from './routes/accounts.js';
import { registerProjects } from './routes/projects.js';
import { registerSources } from './routes/sources.js';
import { registerWorkbooks } from './routes/workbooks.js';
import { registerDashboards } from './routes/dashboards.js';
import { registerExports } from './routes/exports.js';
import { registerInbox } from './routes/inbox.js';
import { registerGrading } from './routes/grading.js';
import { ensureBucket } from './storage.js';
import { ensureSample } from './domain/bootstrap.js';
import { runDueRefreshes } from './domain/extract.js';

const router = new Router();
registerPlatform(router);
registerAccounts(router);
registerProjects(router);
registerSources(router);
registerWorkbooks(router);
registerDashboards(router);
registerExports(router);
registerInbox(router);
if (config.grading) registerGrading(router);

const publicDir = path.join(import.meta.dirname, '..', 'public');

const STATIC_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.woff2': 'font/woff2',
};

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const safe = path.normalize(requested).replace(/^(\.\.[/\\])+/, '');
  const candidate = path.join(publicDir, safe);
  const target = candidate.startsWith(publicDir) ? candidate : path.join(publicDir, 'index.html');
  const ext = path.extname(target);
  try {
    const body = await readFile(target);
    res.writeHead(200, {
      'content-type': STATIC_TYPES[ext] ?? 'application/octet-stream',
      'content-length': body.length,
      'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=3600',
    });
    res.end(body);
  } catch {
    const html = await readFile(path.join(publicDir, 'index.html'));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': html.length, 'cache-control': 'no-store' });
    res.end(html);
  }
}

async function sessionUser(req: IncomingMessage): Promise<SessionUser | null> {
  const cookies = parseCookies(req.headers.cookie);
  const session = cookies.loz_session;
  if (session === undefined || session === '') return null;
  return userForSession(session);
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const match = router.match(req.method ?? 'GET', url.pathname);
  if (match === null) {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }
  const user = await sessionUser(req);
  let raw: Buffer | null = null;
  const method = req.method ?? 'GET';
  const contentType = req.headers['content-type'] ?? '';
  const hasBody = method !== 'GET' && method !== 'HEAD';
  if (hasBody) {
    if (contentType.includes('text/csv')) {
      raw = await readBody(req, config.csvMaxBytes * 2 + 1024);
    } else {
      const length = Number(req.headers['content-length'] ?? '0');
      if (length > 0 && !contentType.includes('application/json')) {
        throw new ApiError(415, 'unsupported_media_type');
      }
      raw = await readBody(req, JSON_LIMIT);
    }
  }
  const ctx: Ctx = {
    req,
    res,
    params: match.params,
    url,
    user,
    body: async () => {
      if (raw === null || raw.length === 0) return {};
      try {
        return JSON.parse(raw.toString('utf8')) as unknown;
      } catch {
        throw new ApiError(422, 'invalid');
      }
    },
    raw: async () => raw ?? Buffer.alloc(0),
    setCookie: (value) => res.setHeader('set-cookie', value),
  };
  await match.handler(ctx);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((err: unknown) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (err instanceof ApiError) {
        sendError(res, err);
        return;
      }
      sendJson(res, 500, { error: 'server_error' });
    });
    return;
  }
  if ((req.method ?? 'GET') !== 'GET') {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }
  serveStatic(url.pathname, res).catch(() => {
    res.writeHead(500);
    res.end();
  });
});

server.listen(config.port, '0.0.0.0');

void (async () => {
  await initDb();
  await ensureBucket();
  await ensureSample().catch(() => undefined);
  setInterval(() => {
    if (!dbReady()) return;
    void runDueRefreshes().catch(() => undefined);
  }, 1000);
})();
