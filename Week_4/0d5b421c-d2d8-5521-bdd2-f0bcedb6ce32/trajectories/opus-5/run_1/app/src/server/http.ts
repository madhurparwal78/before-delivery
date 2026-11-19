import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { config } from './config';
import { ApiError, errors } from './errors';

export const MAX_BODY_BYTES = 16384;

export function asyncHandler(
  handler: (req: Request, res: Response) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

export function sendJson(res: Response, status: number, body: unknown): void {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.send(JSON.stringify(body));
}

const BODYLESS_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Accepts same-origin JSON up to the published size limit. */
export const jsonBody: RequestHandler = (req, _res, next) => {
  if (BODYLESS_METHODS.has(req.method)) {
    req.body = {};
    next();
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  let failed = false;
  req.on('data', (chunk: Buffer) => {
    if (failed) return;
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      failed = true;
      req.pause();
      next(errors.bodyTooLarge());
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (failed) return;
    const raw = Buffer.concat(chunks).toString('utf8');
    if (raw.trim().length === 0) {
      req.body = {};
      next();
      return;
    }
    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
      next(errors.unsupportedMediaType());
      return;
    }
    try {
      req.body = JSON.parse(raw) as unknown;
    } catch {
      next(errors.malformedJson());
      return;
    }
    next();
  });
  req.on('error', () => {
    if (!failed) next(errors.malformedJson());
  });
};

function sameOrigin(req: Request, origin: string): boolean {
  if (origin === config.publicUrl) return true;
  const host = req.headers.host;
  if (!host) return false;
  const protocol = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol;
  return (
    origin === `${protocol}://${host}` ||
    origin === `http://${host}` ||
    origin === `https://${host}`
  );
}

export const originGuard: RequestHandler = (req, _res, next) => {
  if (BODYLESS_METHODS.has(req.method)) {
    next();
    return;
  }
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin !== 'null' && !sameOrigin(req, origin)) {
    next(errors.crossOrigin());
    return;
  }
  next();
};

export function errorHandler(
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
    sendJson(res, error.status, error.body());
    return;
  }
  console.error('Unhandled server error', error);
  sendJson(res, 500, {
    error: {
      code: 'internal_error',
      message: 'Something went wrong on our side.',
    },
  });
}
