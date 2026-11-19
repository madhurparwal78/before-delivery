import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';
import { config } from '../core/config.js';
import { databaseReady, pingDatabase, startDatabase } from '../core/db.js';
import { applySeed } from '../core/seed.js';
import { errors } from '../core/errors.js';
import { sweepExpiredLocks } from '../domain/moderation.js';
import { ensureBucket, storageAvailable } from '../services/s3.js';
import { valkeyAvailable } from '../services/valkey.js';
import { authRoutes } from './routes/auth.js';
import { commentRoutes } from './routes/comments.js';
import { communityRoutes } from './routes/communities.js';
import { gradingRoutes } from './routes/grading.js';
import { moderationRoutes } from './routes/moderation.js';
import { postRoutes } from './routes/posts.js';
import { reportRoutes } from './routes/reports.js';
import { streamRoutes } from './routes/stream.js';
import { pageRoutes } from '../web/pages.js';
import {
  applyBoundary,
  createCtx,
  loadSession,
  matchRoute,
  requireDatabase,
  sendError,
  sendJson,
  type Route,
} from './http.js';

const here = dirname(fileURLToPath(import.meta.url));
const staticRoot = join(here, '..', 'static');

const routes: Route[] = [
  ...authRoutes,
  ...communityRoutes,
  ...postRoutes,
  ...commentRoutes,
  ...moderationRoutes,
  ...reportRoutes,
  ...streamRoutes,
  ...gradingRoutes,
  ...pageRoutes,
];

const STATIC_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

async function serveStatic(pathname: string): Promise<{ body: Buffer; type: string } | null> {
  const relative = normalize(pathname.replace(/^\/static\//, ''));
  if (relative.startsWith('..')) return null;
  const extension = relative.slice(relative.lastIndexOf('.'));
  const type = STATIC_TYPES[extension];
  if (!type) return null;
  try {
    return { body: await readFile(join(staticRoot, relative)), type };
  } catch {
    return null;
  }
}

const server = createServer((req, res) => {
  const ctx = createCtx(req, res);
  void (async () => {
    try {
      const pathname = ctx.url.pathname;

      if (pathname === '/api/health') {
        const [database, storage, live] = await Promise.all([pingDatabase(), storageAvailable(), valkeyAvailable()]);
        sendJson(ctx, 200, { status: database && storage && live ? 'ok' : 'unavailable' });
        return;
      }

      if (pathname.startsWith('/static/')) {
        const asset = await serveStatic(pathname);
        if (!asset) throw errors.notFound('Not found');
        res.writeHead(200, {
          'Content-Type': asset.type,
          'Content-Length': asset.body.length,
          'Cache-Control': 'public, max-age=3600',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(asset.body);
        return;
      }

      requireDatabase();
      await loadSession(ctx);

      if (ctx.member && ctx.member.suspendedAt !== null) {
        if (pathname.startsWith('/api/')) throw errors.suspended();
        ctx.member = null;
        ctx.viewer = { member: null, moderatorOf: new Set() };
      }

      const matched = matchRoute(routes, ctx.method, pathname);
      if (!matched) throw errors.notFound('Not found');
      ctx.params = matched.params;
      await applyBoundary(ctx, matched.route.bodyKind, pathname.startsWith('/api/grading/'));
      await matched.route.handler(ctx);
    } catch (error) {
      if (!res.headersSent) sendError(ctx, error);
      else res.end();
    }
  })();
});

async function start(): Promise<void> {
  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`Moothall listening on http://0.0.0.0:${config.port}\n`);
  });

  await ensureBucket().catch(() => undefined);
  await startDatabase(applySeed);

  setInterval(() => {
    if (databaseReady()) void sweepExpiredLocks().catch(() => undefined);
  }, 1000);
}

void start();
