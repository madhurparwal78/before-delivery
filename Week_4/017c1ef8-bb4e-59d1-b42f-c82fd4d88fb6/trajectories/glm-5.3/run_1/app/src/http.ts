import express, { Express, Request, Response, NextFunction, RequestHandler } from 'express';
import { errors, sendError } from './errors.js';
import { query } from './db.js';
import { randomUUID } from 'node:crypto';

export type Auth = { memberId: string };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: Auth;
      rawBody?: Buffer;
    }
  }
}

const JSON_MAX = 1_000_000;

export const sameOriginGuard: RequestHandler = (req, _res, next) => {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') { next(); return; }
  const origin = req.headers.origin;
  if (origin) {
    const host = req.headers.host;
    try {
      if (new URL(origin).host !== host) { next(errors.crossOrigin()); return; }
    } catch {
      next(errors.crossOrigin());
      return;
    }
  }
  next();
};

export const jsonBody = (limit = JSON_MAX): RequestHandler => (req, res, next) => {
  const contentType = req.headers['content-type'] ?? '';
  if (!contentType.startsWith('application/json')) {
    if (contentType === '' || contentType.startsWith('multipart/form-data')) { req.rawBody = undefined; next(); return; }
    next(errors.unsupportedMediaType());
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  req.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > limit) {
      res.status(413).json({ error: 'payload_too_large' });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    const buf = Buffer.concat(chunks);
    req.rawBody = buf;
    try {
      if (buf.length === 0) { (req as unknown as { body: unknown }).body = {}; next(); return; }
      (req as unknown as { body: unknown }).body = JSON.parse(buf.toString('utf8'));
      next();
    } catch {
      next(errors.unsupportedMediaType());
    }
  });
  req.on('error', () => { /* client aborted */ });
};

export const cookieSession = (async (req, _res, next) => {
  const cookies = parseCookies(req.headers.cookie ?? '');
  const token = cookies.pw_session;
  if (token) {
    const result = await query<{ member_id: string }>(
      'SELECT member_id FROM sessions WHERE token = $1', [token]);
    if (result.rows.length > 0) {
      req.auth = { memberId: result.rows[0].member_id };
    }
  }
  next();
}) as RequestHandler;

export const requireSession: RequestHandler = (req, _res, next) => {
  if (!req.auth) { next(errors.unauthenticated()); return; }
  next();
};

export const setSessionCookie = (res: Response, token: string): void => {
  res.setHeader('Set-Cookie', `pw_session=${token}; HttpOnly; SameSite=Lax; Path=/`);
};

export const clearSessionCookie = (res: Response): void => {
  res.setHeader('Set-Cookie', 'pw_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
};

export const newSessionToken = (): string => randomUUID() + randomUUID();

export const parseCookies = (header: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
};

export const wrap = (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => { fn(req, res).catch(next); };

export const errorHandler = (err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
  sendError(res, err);
};

export const notFoundHandler = (_req: Request, res: Response): void => {
  if (res.headersSent) return;
  res.status(404).json({ error: 'not_found' });
};

export const appExpress = (): Express => {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  return app;
};
