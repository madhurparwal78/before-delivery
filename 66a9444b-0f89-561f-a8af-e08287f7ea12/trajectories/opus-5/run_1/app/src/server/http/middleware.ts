import type { NextFunction, Request, Response } from 'express';
import { limits } from '../config.js';
import { one, pool } from '../db/pool.js';
import { sign, verifySignature } from '../lib/codes.js';
import {
  ApiError,
  ValidationError,
  crossOrigin,
  forbidden,
  payloadTooLarge,
  unauthenticated,
  unsupportedMediaType,
} from '../lib/errors.js';
import { PaymentUnavailable } from '../services/killbill.js';
import { StorageUnavailable } from '../services/storage.js';
import { appSecret } from './secret.js';

export type Role =
  | 'visitor'
  | 'group_booker'
  | 'artist'
  | 'curator'
  | 'box_office'
  | 'finance'
  | 'admin';

export interface Caller {
  id: string;
  email: string;
  name: string;
  role: Role;
  organisationId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      caller: Caller | null;
      rawBody: Buffer;
      body: unknown;
    }
  }
}

export const SESSION_COOKIE = 'kerf_session';

function readCookie(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export async function setSessionCookie(res: Response, sessionId: string): Promise<void> {
  const secret = await appSecret();
  const value = `${sessionId}.${sign(secret, sessionId)}`;
  res.cookie(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 3600 * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/' });
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** The app sends no CORS headers and refuses state-changing requests from another origin. */
export function originGuard(req: Request, _res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin !== 'null' && STATE_CHANGING.has(req.method)) {
    let sameOrigin = false;
    try {
      sameOrigin = new URL(origin).host === req.headers.host;
    } catch {
      sameOrigin = false;
    }
    if (!sameOrigin) {
      next(crossOrigin());
      return;
    }
  }
  next();
}

function bodyLimitFor(path: string): number {
  if (/^\/api\/orders\/[^/]+\/proof$/.test(path)) return limits.proofBytes;
  if (/^\/api\/entries\/[^/]+\/images$/.test(path)) return limits.artworkBytes;
  return limits.jsonBytes;
}

const MULTIPART_OVERHEAD = 1024;

export function bodyReader(req: Request, _res: Response, next: NextFunction): void {
  if (!STATE_CHANGING.has(req.method)) {
    req.rawBody = Buffer.alloc(0);
    req.body = {};
    next();
    return;
  }

  const contentType = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const isMultipart = contentType === 'multipart/form-data';
  const limit = bodyLimitFor(req.path) + (isMultipart ? MULTIPART_OVERHEAD : 0);

  const declared = Number(req.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > limit) {
    next(payloadTooLarge());
    return;
  }

  const chunks: Buffer[] = [];
  let size = 0;
  let failed = false;

  req.on('data', (chunk: Buffer) => {
    if (failed) return;
    size += chunk.byteLength;
    if (size > limit) {
      failed = true;
      next(payloadTooLarge());
      return;
    }
    chunks.push(chunk);
  });

  req.on('end', () => {
    if (failed) return;
    req.rawBody = Buffer.concat(chunks);
    if (isMultipart) {
      req.body = {};
      next();
      return;
    }
    if (req.rawBody.byteLength === 0) {
      req.body = {};
      next();
      return;
    }
    if (contentType !== 'application/json') {
      next(unsupportedMediaType());
      return;
    }
    try {
      req.body = JSON.parse(req.rawBody.toString('utf8'));
    } catch {
      next(unsupportedMediaType());
      return;
    }
    next();
  });

  req.on('error', () => {
    if (!failed) next(payloadTooLarge());
  });
}

export async function loadCaller(req: Request, _res: Response, next: NextFunction): Promise<void> {
  req.caller = null;
  const raw = readCookie(req.headers.cookie, SESSION_COOKIE);
  if (raw === null) {
    next();
    return;
  }
  const separator = raw.lastIndexOf('.');
  if (separator <= 0) {
    next();
    return;
  }
  const sessionId = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);
  try {
    const secret = await appSecret();
    if (!verifySignature(secret, sessionId, signature)) {
      next();
      return;
    }
    const row = await one<{
      id: string;
      email: string;
      name: string;
      role: Role;
      organisation_id: string | null;
    }>(
      pool,
      `SELECT u.id, u.email, u.name, u.role, u.organisation_id FROM auth_sessions s
       JOIN users u ON u.id = s.user_id WHERE s.id = $1`,
      [sessionId],
    );
    if (row !== null) {
      req.caller = {
        id: row.id,
        email: row.email,
        name: row.name,
        role: row.role,
        organisationId: row.organisation_id,
      };
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function requireCaller(req: Request): Caller {
  if (req.caller === null) throw unauthenticated();
  return req.caller;
}

export function requireRole(req: Request, ...roles: readonly Role[]): Caller {
  const caller = requireCaller(req);
  if (!roles.includes(caller.role)) throw forbidden();
  return caller;
}

/** Every API error goes through this one shape. */
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
  if (error instanceof ValidationError) {
    res.status(422).json({ errors: error.errors });
    return;
  }
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: error.code, ...error.extra });
    return;
  }
  if (error instanceof PaymentUnavailable) {
    res.status(503).json({ error: 'payment_unavailable' });
    return;
  }
  if (error instanceof StorageUnavailable) {
    res.status(503).json({ error: 'storage_unavailable' });
    return;
  }
  process.stderr.write(`unhandled request failure: ${String(error)}\n`);
  res.status(500).json({ error: 'internal_error' });
}
