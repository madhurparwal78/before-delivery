import express, { NextFunction, Request, Response } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config';
import { isSchemaReady } from '../db/ready';
import { ApiError } from './errors';
import { fail } from './errors';
import { registerAuthRoutes } from './routes/auth';
import { registerMemberRoutes } from './routes/members';
import { registerAgentRoutes } from './routes/agents';
import { registerSceneRoutes } from './routes/scenes';
import { registerAssetRoutes } from './routes/assets';
import { registerCommentRoutes } from './routes/comments';
import { registerVersionRoutes } from './routes/versions';
import { registerReviewRoutes } from './routes/review';
import { registerBillingRoutes } from './routes/billing';
import { route } from './route';
import { storageReachable } from '../services/storage';
import { reachable as killbillReachable } from '../services/killbill';

const ASSET_BODY_LIMIT = 20_100_000;
const THUMBNAIL_BODY_LIMIT = 1_000_000;
const DEFAULT_BODY_LIMIT = 1_000_000;

function bodyLimitFor(req: Request): number {
  if (req.method === 'POST' && req.path === '/api/assets') return ASSET_BODY_LIMIT;
  if (req.method === 'PUT' && /^\/api\/versions\/[^/]+\/thumbnail$/.test(req.path)) {
    return THUMBNAIL_BODY_LIMIT;
  }
  return DEFAULT_BODY_LIMIT;
}

function readBody(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD') {
    req.rawBody = Buffer.alloc(0);
    req.body = {};
    next();
    return;
  }
  const limit = bodyLimitFor(req);
  const chunks: Buffer[] = [];
  let size = 0;
  let finished = false;
  req.on('data', (chunk: Buffer) => {
    if (finished) return;
    size += chunk.length;
    if (size > limit) {
      finished = true;
      const error = fail.payloadTooLarge(limit);
      res.status(error.status).json(error.body);
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (finished) return;
    finished = true;
    req.rawBody = Buffer.concat(chunks);
    const contentType = req.headers['content-type'] ?? '';
    if (contentType.includes('application/json') && req.rawBody.length > 0) {
      try {
        const parsed = JSON.parse(req.rawBody.toString('utf8')) as unknown;
        req.body =
          parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : { value: parsed };
      } catch {
        req.body = {};
      }
    } else {
      req.body = {};
    }
    next();
  });
  req.on('error', () => {
    if (finished) return;
    finished = true;
    next();
  });
}

function ownOrigins(req: Request): string[] {
  const host = req.headers.host ?? '';
  const scheme = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  const origins = [`${scheme}://${host}`];
  try {
    origins.push(new URL(config.publicUrl).origin);
  } catch {
    // An unparseable public URL simply adds no extra origin.
  }
  return origins;
}

const ORIGIN_FREE_PATHS = [/^\/api\/billing\/webhook$/];

function originGuard(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  if (ORIGIN_FREE_PATHS.some((pattern) => pattern.test(req.path))) {
    next();
    return;
  }
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.length > 0 && !ownOrigins(req).includes(origin)) {
    const error = fail.crossOrigin();
    res.status(error.status).json(error.body);
    return;
  }
  next();
}

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');
  app.use(readBody);
  app.use(originGuard);

  app.use((req, res, next) => {
    if (
      (req.path.startsWith('/review/') || req.path.startsWith('/api/review/')) &&
      req.method !== 'GET' &&
      req.method !== 'HEAD'
    ) {
      const error = fail.readOnlyMethod();
      res.status(error.status).json(error.body);
      return;
    }
    next();
  });

  app.get('/api/health', (_req, res) => {
    if (!isSchemaReady()) {
      res.status(503).json({ error: 'service_unavailable', service: 'database' });
      return;
    }
    res.json({ status: 'ok' });
  });

  // Backs the Service status banner, which must follow a service recovering.
  let statusCache: { at: number; body: { fileStorage: string; billing: string } } | null = null;
  app.get(
    '/api/service-status',
    route(async (_req, res) => {
      if (statusCache && Date.now() - statusCache.at < 2_000) {
        res.json(statusCache.body);
        return;
      }
      const [storage, billing] = await Promise.all([storageReachable(), killbillReachable()]);
      const body = {
        fileStorage: storage ? 'up' : 'down',
        billing: billing ? 'up' : 'down',
      };
      statusCache = { at: Date.now(), body };
      res.json(body);
    }),
  );

  registerAuthRoutes(app);
  registerMemberRoutes(app);
  registerAgentRoutes(app);
  registerSceneRoutes(app);
  registerAssetRoutes(app);
  registerCommentRoutes(app);
  registerVersionRoutes(app);
  registerReviewRoutes(app);
  registerBillingRoutes(app);

  const publicDir = join(__dirname, '..', '..', 'public');
  const shellPath = join(publicDir, 'index.html');
  const shell = existsSync(shellPath) ? readFileSync(shellPath, 'utf8') : '';

  app.get('/app.js', (_req, res) => {
    res.type('application/javascript').send(readFileSync(join(publicDir, 'app.js')));
  });
  app.get('/styles.css', (_req, res) => {
    res.type('text/css').send(readFileSync(join(publicDir, 'styles.css')));
  });
  app.get('/fonts/:file', (req, res, next) => {
    const file = req.params.file;
    if (!/^[a-z0-9.-]+\.woff2$/.test(file)) {
      next();
      return;
    }
    const path = join(publicDir, 'fonts', file);
    if (!existsSync(path)) {
      next();
      return;
    }
    res.type('font/woff2').setHeader('Cache-Control', 'public, max-age=86400');
    res.send(readFileSync(path));
  });

  const shellRoutes = [
    '/',
    '/pricing',
    '/signup',
    '/login',
    '/invite/:token',
    '/app',
    '/app/scenes',
    '/app/scenes/:sceneId',
    '/app/members',
    '/app/agents',
    '/app/audit',
    '/app/billing',
    '/app/settings',
    '/review/:token',
    '/embed/:embedId',
  ];
  for (const route of shellRoutes) {
    app.get(route, (_req, res) => {
      res.type('text/html').send(shell);
    });
  }

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      const error = fail.notFound();
      res.status(error.status).json(error.body);
      return;
    }
    res.status(404).type('text/html').send('<!doctype html><title>Not found</title><p>Not found.</p>');
  });

  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error instanceof ApiError) {
      res.status(error.status).json(error.body);
      return;
    }
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
