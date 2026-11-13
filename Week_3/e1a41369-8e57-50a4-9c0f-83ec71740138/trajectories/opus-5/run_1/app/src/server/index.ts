import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { applySchema, checkDatabase, isDatabaseReady } from './db.js';
import { applySeed } from './seed.js';
import { ensureBucket, storageReachable } from './storage.js';
import { Ctx, Router, bodyCapFor, originAllowed, readBody } from './http/core.js';
import { ApiError, fail } from './http/errors.js';
import { addConnection, heartbeat } from './live.js';
import { query } from './db.js';
import { userForSession } from './services/auth.js';
import { runDueCloses } from './services/close.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerTaskRoutes } from './routes/tasks.js';
import { registerPartyRoutes } from './routes/party.js';
import { registerQuestRoutes } from './routes/quests.js';
import { registerFileRoutes } from './routes/files.js';
import { registerGradingRoutes } from './routes/grading.js';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, '../public');

const PAGE_PATHS = new Set(['/', '/signin', '/board', '/settings', '/imports', '/history']);
const STATIC_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const router = new Router();
registerAuthRoutes(router);
registerTaskRoutes(router);
registerPartyRoutes(router);
registerQuestRoutes(router);
registerFileRoutes(router);
registerGradingRoutes(router);

router.add('GET', '/api/health', async (ctx) => {
  if (!isDatabaseReady() && !(await checkDatabase())) {
    ctx.send(503, { status: 'starting' });
    return;
  }
  ctx.send(200, { status: (await storageReachable()) ? 'ok' : 'unavailable' });
});

router.add('GET', '/api/live', (ctx) => {
  const user = ctx.requireUser();
  ctx.res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  ctx.res.write(': open\n\n');
  const remove = addConnection(user.id, ctx.res);
  ctx.req.on('close', remove);
});

let pageHtml: Buffer | null = null;

async function servePage(res: ServerResponse): Promise<void> {
  if (!pageHtml) {
    const template = await readFile(join(publicDir, 'index.html'), 'utf8');
    pageHtml = Buffer.from(
      template.replace('__CHAT_MAX_PER_MINUTE__', String(config.chatMaxPerMinute)),
      'utf8',
    );
  }
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': String(pageHtml.byteLength),
    'cache-control': 'no-store',
  });
  res.end(pageHtml);
}

async function serveStatic(path: string, res: ServerResponse): Promise<boolean> {
  const extension = extname(path);
  const type = STATIC_TYPES[extension];
  if (!type) return false;
  const target = resolve(publicDir, `.${normalize(path)}`);
  if (!target.startsWith(publicDir)) return false;
  let bytes: Buffer;
  try {
    bytes = await readFile(target);
  } catch {
    return false;
  }
  res.writeHead(200, {
    'content-type': type,
    'content-length': String(bytes.byteLength),
    'cache-control': 'no-store',
  });
  res.end(bytes);
  return true;
}

function sendError(res: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.byteLength),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;

  if (!originAllowed(req)) {
    sendError(res, 403, { error: 'cross_origin' });
    return;
  }

  const match = router.match(req.method ?? 'GET', path);
  if (!match) {
    if (req.method === 'GET' && (PAGE_PATHS.has(path) || /^\/quests\/[^/]+$/.test(path))) {
      await servePage(res);
      return;
    }
    if (req.method === 'GET' && (await serveStatic(path, res))) return;
    sendError(res, 404, { error: 'not_found' });
    return;
  }

  const ctx = new Ctx(req, res, path, url.searchParams);
  ctx.params = match.params;
  const { body, tooLarge } = await readBody(req, bodyCapFor(router.isUploadPath(req.method ?? 'GET', path)));
  ctx.rawBody = body;
  ctx.bodyTooLarge = tooLarge;

  try {
    if (path !== '/api/health' && !isDatabaseReady() && !(await checkDatabase())) {
      sendError(res, 503, { error: 'database_unavailable' });
      return;
    }
    const token = ctx.sessionToken();
    if (token) ctx.user = await userForSession({ query }, token);
    await match.route.handler(ctx);
  } catch (error) {
    if (error instanceof ApiError) {
      sendError(res, error.status, error.body);
      return;
    }
    if (error instanceof Error && (error as { code?: string }).code === '22P02') {
      const notFound = fail('not_found');
      sendError(res, notFound.status, notFound.body);
      return;
    }
    process.stderr.write(`request failed: ${String(error)}\n`);
    sendError(res, 500, { error: 'server_error' });
  }
}

const server = createServer((req, res) => {
  handle(req, res).catch(() => {
    if (!res.headersSent) sendError(res, 500, { error: 'server_error' });
  });
});

server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`deedfall listening on ${config.port}\n`);
});

async function boot(): Promise<void> {
  for (;;) {
    try {
      await applySchema();
      await applySeed();
      break;
    } catch (error) {
      process.stderr.write(`waiting for the database: ${String(error)}\n`);
      await new Promise((done) => setTimeout(done, 2000));
    }
  }
  ensureBucket().catch(() => undefined);
}

void boot();

// Every due close runs well inside the published minute of its instant.
let closing = false;
setInterval(() => {
  if (closing || !isDatabaseReady()) return;
  closing = true;
  runDueCloses(Date.now())
    .catch(() => undefined)
    .finally(() => {
      closing = false;
    });
}, 30_000);

setInterval(heartbeat, 20_000);
