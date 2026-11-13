import { randomBytes } from 'node:crypto';
import * as cookie from 'cookie';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { config } from './config.js';
import { ApiError, fail, sendError } from './errors.js';
import type { StaffIdentity, StaffRole } from './services/identity.js';

export const MAX_JSON_BYTES = 64_000;
const SESSION_COOKIE = 'press_staff';

export interface PressRequest extends Request {
  rawBody?: Buffer;
  jsonBody?: Record<string, unknown>;
  staff?: StaffIdentity;
}

const sessions = new Map<string, StaffIdentity>();

export function openSession(res: Response, identity: StaffIdentity): void {
  const id = randomBytes(24).toString('hex');
  sessions.set(id, identity);
  res.setHeader(
    'Set-Cookie',
    cookie.serialize(SESSION_COOKIE, id, { httpOnly: true, sameSite: 'lax', path: '/' }),
  );
}

export function closeSession(req: Request, res: Response): void {
  const id = cookie.parse(req.headers.cookie ?? '')[SESSION_COOKIE];
  if (id !== undefined) sessions.delete(id);
  res.setHeader('Set-Cookie', cookie.serialize(SESSION_COOKIE, '', { path: '/', maxAge: 0 }));
}

export function sessionIdentity(req: Request): StaffIdentity | null {
  const id = cookie.parse(req.headers.cookie ?? '')[SESSION_COOKIE];
  if (id === undefined) return null;
  return sessions.get(id) ?? null;
}

/** The raw body is kept so gateway callbacks can be verified on it. */
export const readBody: RequestHandler = (req, res, next) => {
  const request = req as PressRequest;
  if (req.method === 'GET' || req.method === 'HEAD') {
    next();
    return;
  }
  const type = (req.headers['content-type'] ?? '').split(';')[0]?.trim() ?? '';
  if (type.startsWith('multipart/form-data')) {
    next();
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  let refused = false;
  req.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_JSON_BYTES && !refused) {
      refused = true;
      sendError(res, fail(413, 'body_too_large'));
      req.destroy();
      return;
    }
    if (!refused) chunks.push(chunk);
  });
  req.on('end', () => {
    if (refused) return;
    request.rawBody = Buffer.concat(chunks);
    if (request.rawBody.length === 0) {
      request.jsonBody = {};
      next();
      return;
    }
    if (type !== 'application/json') {
      sendError(res, fail(415, 'unsupported_media_type'));
      return;
    }
    try {
      const parsed = JSON.parse(request.rawBody.toString('utf8')) as unknown;
      request.jsonBody = (parsed ?? {}) as Record<string, unknown>;
    } catch {
      request.jsonBody = {};
    }
    next();
  });
  req.on('error', () => undefined);
};

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const refuseForeignOrigin: RequestHandler = (req, res, next) => {
  const origin = req.headers.origin;
  if (!STATE_CHANGING.has(req.method) || origin === undefined || origin === 'null') {
    next();
    return;
  }
  if (req.path === '/api/gateway/callbacks') {
    next();
    return;
  }
  const allowed = new Set([config.publicUrl, `${req.protocol}://${req.headers.host ?? ''}`]);
  if (allowed.has(origin)) {
    next();
    return;
  }
  sendError(res, fail(403, 'origin_refused'));
};

/** Reads the staff session cookie or bearer token onto the request. */
export function attachStaff(
  fromToken: (token: string) => Promise<StaffIdentity | null>,
): RequestHandler {
  return (req, unusedResponse, next) => {
    const request = req as PressRequest;
    const bearer = req.headers.authorization;
    if (typeof bearer === 'string' && bearer.startsWith('Bearer ')) {
      void fromToken(bearer.slice(7)).then((identity) => {
        if (identity !== null) request.staff = identity;
        next();
      });
      return;
    }
    const session = sessionIdentity(req);
    if (session !== null) request.staff = session;
    next();
  };
}

export function requireStaff(...roles: StaffRole[]): RequestHandler {
  return (req, res, next) => {
    const request = req as PressRequest;
    const identity = request.staff;
    if (identity === undefined) {
      sendError(res, fail(401, 'sign_in_required'));
      return;
    }
    if (roles.length > 0 && !roles.some((role) => identity.roles.includes(role))) {
      sendError(res, fail(403, 'forbidden'));
      return;
    }
    next();
  };
}

export function handler(
  work: (req: PressRequest, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    work(req as PressRequest, res).catch((error: unknown) => {
      if (error instanceof ApiError) {
        sendError(res, error);
        return;
      }
      next(error);
    });
  };
}

export function requireHeader(req: PressRequest, name: string): string {
  const value = req.headers[name.toLowerCase()];
  return typeof value === 'string' ? value : '';
}
