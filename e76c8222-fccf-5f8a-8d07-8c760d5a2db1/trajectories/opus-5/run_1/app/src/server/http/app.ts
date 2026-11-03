import path from 'node:path';
import express, { Express, NextFunction, Request, Response } from 'express';
import { ApiError, fail } from './errors';
import { attachUser } from './auth';
import { systemRouter } from './routes/system';
import { requestsRouter } from './routes/requests';
import { dispatchRouter } from './routes/dispatch';
import { interpretersRouter } from './routes/interpreters';
import { billingRouter } from './routes/billing';
import { preferencesRouter } from './routes/preferences';

const CLIENT_DIR = path.resolve(__dirname, '../../client');
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function sameOriginOnly(req: Request, _res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (MUTATING.has(req.method) && typeof origin === 'string' && origin !== 'null') {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw fail('cross_origin');
    }
    if (originHost !== req.headers.host) throw fail('cross_origin');
  }
  next();
}

interface BodyParserError extends Error {
  type?: string;
  status?: number;
}

function bodyErrors(
  error: BodyParserError,
  _req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (error.type === 'entity.too.large') {
    next(fail('payload_too_large'));
    return;
  }
  if (error.type === 'entity.parse.failed' || error instanceof SyntaxError) {
    next(fail('bad_json'));
    return;
  }
  next(error);
}

function errorResponder(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }
  if (error instanceof ApiError) {
    res.status(error.status).json(error.body());
    return;
  }
  console.error('unhandled failure', error);
  res.status(500).json({ error: { code: 'internal', message: 'Something went wrong.' } });
}

/** Client routes have no dots in their last segment; anything else is a file we do not serve. */
function looksLikeFile(pathname: string): boolean {
  const last = pathname.split('/').pop() ?? '';
  return last.includes('.');
}

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  const api = express.Router();
  api.use(sameOriginOnly);
  api.use(express.json({ limit: '64kb' }));
  api.use(bodyErrors);
  api.use(attachUser);
  api.use(systemRouter);
  api.use(preferencesRouter);
  api.use(requestsRouter);
  api.use(dispatchRouter);
  api.use(interpretersRouter);
  api.use(billingRouter);
  api.use((_req, _res, next) => {
    next(fail('not_found'));
  });
  app.use('/api', api);

  app.use(
    express.static(CLIENT_DIR, {
      index: false,
      dotfiles: 'ignore',
      maxAge: 0,
      setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next(fail('not_found'));
      return;
    }
    if (looksLikeFile(req.path)) {
      next(fail('not_found'));
      return;
    }
    res.sendFile(path.join(CLIENT_DIR, 'index.html'));
  });

  app.use(errorResponder);
  return app;
}
