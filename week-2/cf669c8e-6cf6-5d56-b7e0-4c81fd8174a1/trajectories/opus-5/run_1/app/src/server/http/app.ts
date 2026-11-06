/**
 * The HTTP app: the server boundary and every route.
 *
 * Same-origin only, with no cross-origin headers sent. Bodies may be up to and
 * including 65,536 bytes. Only the built client is served, so no source file,
 * environment file, credential or callback secret can leave the server.
 */

import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { DatabaseUnreachable } from '../db/pool.js';
import { ApiError, IdempotentReplay, ValidationError } from './errors.js';
import { SESSION_COOKIE } from '../services/auth.js';
import { registerSystemRoutes } from './routes/system.js';
import { registerCatalogueRoutes } from './routes/catalogue.js';
import { registerOrderRoutes } from './routes/orders.js';
import { registerRideRoutes } from './routes/rides.js';
import { registerDeskRoutes } from './routes/desk.js';
import { registerNotificationRoutes } from './routes/notifications.js';

export const MAX_BODY_BYTES = 65_536;

/** The callback carries no browser origin and is exempt from the origin check. */
const ORIGIN_EXEMPT = /^\/api\/killbill\/notifications\//;

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function originGuard(req: Request, res: Response, next: NextFunction): void {
  if (!STATE_CHANGING.has(req.method) || ORIGIN_EXEMPT.test(req.path)) {
    next();
    return;
  }
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || origin.length === 0) {
    next();
    return;
  }
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    res.status(403).json({ error: 'cross_origin' });
    return;
  }
  if (originHost !== req.headers.host) {
    res.status(403).json({ error: 'cross_origin' });
    return;
  }
  next();
}

function isBodyTooLarge(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { type?: string }).type === 'entity.too.large'
  );
}

function isBadJson(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { type?: string }).type === 'entity.parse.failed'
  );
}

export function createApp(clientDir: string): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  app.use(originGuard);
  app.use(
    express.json({
      limit: MAX_BODY_BYTES,
      type: ['application/json', 'application/*+json'],
    }),
  );

  // A body that failed to parse must answer in the one failure shape.
  app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    if (isBodyTooLarge(error)) {
      res.status(413).json({ error: 'payload_too_large' });
      return;
    }
    if (isBadJson(error)) {
      if (ORIGIN_EXEMPT.test(req.path)) {
        res.status(400).json({ error: 'bad_notification' });
        return;
      }
      res.status(422).json({ errors: { body: 'Send JSON.' } });
      return;
    }
    next(error);
  });

  const api = express.Router();
  registerSystemRoutes(api);
  registerCatalogueRoutes(api);
  registerOrderRoutes(api);
  registerRideRoutes(api);
  registerDeskRoutes(api);
  registerNotificationRoutes(api);
  app.use('/api', api);

  // An unknown API route answers like any other missing thing.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  app.use(
    express.static(clientDir, {
      index: false,
      etag: true,
      setHeaders: (res, path) => {
        if (/\.(woff2|woff|ttf)$/.test(path)) {
          res.setHeader('cache-control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );

  // Every other address is a screen the client router renders.
  const indexFile = join(clientDir, 'index.html');
  app.get('*', (_req, res, next) => {
    if (!existsSync(indexFile)) {
      next(new Error('the client build is missing; run npm run build'));
      return;
    }
    res.setHeader('cache-control', 'no-cache');
    res.sendFile(indexFile);
  });

  app.use(errorHandler);
  return app;
}

function errorHandler(error: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof IdempotentReplay) {
    res.status(error.status).json(error.body);
    return;
  }
  if (error instanceof ValidationError) {
    res.status(422).json({ errors: error.errors });
    return;
  }
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: error.code });
    return;
  }
  if (error instanceof DatabaseUnreachable) {
    res.status(503).json({ error: 'database_unreachable' });
    return;
  }

  console.error('[http] unhandled', error);
  res.status(500).json({ error: 'server_error' });
}

export { SESSION_COOKIE };
