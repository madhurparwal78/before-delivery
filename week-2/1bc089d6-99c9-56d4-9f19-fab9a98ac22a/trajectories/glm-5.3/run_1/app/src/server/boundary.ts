import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../shared/errors.js';

export const BODY_LIMIT = 16_384;

export function readBody(req: Request): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? '0');
    if (Number.isFinite(declared) && declared > BODY_LIMIT) {
      reject(new ApiError('too_large'));
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > BODY_LIMIT) {
        done = true;
        reject(new ApiError('too_large'));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      const raw = Buffer.concat(chunks);
      if (raw.length === 0) {
        resolve(undefined);
        return;
      }
      const type = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
      if (type !== 'application/json') {
        reject(new ApiError('unsupported_media_type'));
        return;
      }
      try {
        resolve(JSON.parse(raw.toString('utf8')));
      } catch {
        reject(new ApiError('invalid_json'));
      }
    });
    req.on('error', () => {
      if (done) return;
      done = true;
      reject(new ApiError('invalid'));
    });
  });
}

// Same-origin writes: a write whose Origin is present and does not match the
// addressed origin is refused.
export function isCrossOrigin(req: Request): boolean {
  const origin = req.headers.origin;
  if (!origin) return false;
  const host = req.headers.host;
  if (!host) return true;
  const proto = req.headers['x-forwarded-proto'] ?? req.protocol ?? 'http';
  const addressed = normalizeOrigin(`${proto}://${host}`);
  return normalizeOrigin(origin) !== addressed;
}

function normalizeOrigin(origin: string): string {
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return origin;
  }
  const port = u.port;
  if ((u.protocol === 'https:' && port === '443') || (u.protocol === 'http:' && port === '80')) {
    return `${u.protocol}//${u.hostname}`;
  }
  return `${u.protocol}//${u.hostname}${port ? ':' + port : ''}`;
}

export function isDbFailure(err: unknown): boolean {
  if (err instanceof ApiError) return false;
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: string }).code;
    return typeof code === 'string' &&
      (code.startsWith('28') || code.startsWith('53') || code.startsWith('57') || code.startsWith('08') ||
        code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT' ||
        code === 'ENOTFOUND' || code === 'EHOSTUNREACH' || code === 'EPIPE' || code === 'ECONNABORTED');
  }
  return false;
}

export function sendApiError(res: Response, err: unknown): void {
  if (err instanceof ApiError) {
    if (err.retryAfter !== undefined) res.setHeader('Retry-After', String(err.retryAfter));
    res.status(err.status).json(err.body());
    return;
  }
  if (isDbFailure(err)) {
    const e = new ApiError('unavailable');
    res.status(e.status).json(e.body());
    return;
  }
  const e = new ApiError('internal');
  res.status(e.status).json(e.body());
}

// Wraps a route handler so unexpected and database failures use the one error shape.
export function h(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
