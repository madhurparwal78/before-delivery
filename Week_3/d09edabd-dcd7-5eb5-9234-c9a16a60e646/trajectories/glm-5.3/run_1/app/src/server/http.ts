import crypto from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { config } from './config.js';
import { ApiError } from './errors.js';
import { dbUp } from './db.js';

/** Async route wrapper so thrown ApiErrors reach the one error handler. */
export function route(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

export const KB_COOKIE = 'kb_session';

/**
 * Body-size limits with 413 (the limit itself is allowed). Checks
 * Content-Length and destroys the socket when the stream runs past the
 * limit, without consuming the body that the parser needs.
 */
export function sizeLimit(maxBytes: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const len = Number(req.headers['content-length'] ?? 0);
    if (Number.isFinite(len) && len > maxBytes) {
      res.status(413).json({ error: 'too_large' });
      res.end();
      return;
    }
    next();
  };
}

/** Same-origin only: refuse cross-origin writes. */
export function sameOriginGuard(req: Request, _res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  const origin = req.headers.origin;
  if (origin) {
    try {
      const o = new URL(origin);
      const host = req.headers.host ?? '';
      if (o.host !== host) {
        next(new ApiError(403, 'cross_origin'));
        return;
      }
    } catch {
      next(new ApiError(403, 'cross_origin'));
      return;
    }
  }
  next();
}

export function sessionCookie(_token: string): { name: string; options: Record<string, unknown> } {
  return {
    name: KB_COOKIE,
    options: {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 3600 * 1000,
    },
  };
}

/** Health figures from the one availability source of each client. */
export async function healthBody() {
  const [postgres, valkey, minio, mail] = await Promise.all([
    dbUp(),
    import('./valkey.js').then((m) => m.checkValkey()),
    import('./minio.js').then((m) => m.checkMinio()),
    import('./mail.js').then((m) => m.checkMail()),
  ]);
  return {
    status: 'ok',
    instance: config.instance,
    services: { postgres: postgres ? 'up' : 'down', valkey: valkey ? 'up' : 'down', minio: minio ? 'up' : 'down', mail: mail ? 'up' : 'down' },
  };
}

export function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export async function requireDb(next: NextFunction): Promise<void> {
  if (await dbUp()) return;
  next(new ApiError(503, 'database_unavailable'));
}
