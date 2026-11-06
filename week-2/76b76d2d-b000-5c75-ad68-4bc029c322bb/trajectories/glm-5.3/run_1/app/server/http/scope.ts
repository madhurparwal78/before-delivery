import type { NextFunction, Request, Response } from 'express';
import {
  ApiError, bodyLimitBytes, crossOriginError, forbiddenError,
  notFoundError, requestLocale, unauthenticatedError,
} from './errors';
import type { AccountRole, Locale } from '../domain/model';
import type { AccountRow } from '../services/store';
import { accountFromSession } from '../services/store';

export interface RequestScope {
  locale: Locale;
  account: AccountRow | null;
  sessionId: string;
  requireAccount: () => AccountRow;
  requireRole: (role: AccountRole) => AccountRow;
  requirePatron: () => AccountRow;
  json: <T = Record<string, unknown>>() => T;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      scope?: RequestScope;
      jsonBody?: unknown;
    }
  }
}

export interface CookiedRequest extends Request {
  cookies: Record<string, string>;
  rawBody?: Buffer;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

/**
 * Reads the raw body under the published limits: at most 16,384 bytes, empty
 * bodies count as {}, non-JSON content types refused, unparsable JSON refused.
 * The checks run in the published precedence: 413, then 415, then 400.
 */
export function readBody(req: CookiedRequest, res: Response, next: NextFunction): void {
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  req.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > bodyLimitBytes) {
      tooLarge = true;
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (tooLarge) {
      res.status(413).json({ error: { code: 'body_too_large', message: '' } });
      return;
    }
    const raw = Buffer.concat(chunks);
    req.rawBody = raw;
    if (raw.length === 0) {
      req.jsonBody = {};
      next();
      return;
    }
    const header = req.headers['content-type'];
    const mediaType = (typeof header === 'string' ? header : '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (mediaType !== 'application/json') {
      res.status(415).json({ error: { code: 'unsupported_media_type', message: '' } });
      return;
    }
    try {
      req.jsonBody = JSON.parse(raw.toString('utf8')) as unknown;
    } catch {
      res.status(400).json({ error: { code: 'invalid_json', message: '' } });
      return;
    }
    next();
  });
  req.on('error', () => {
    res.status(400).json({ error: { code: 'invalid_json', message: '' } });
  });
}

/** The cross-origin rule: no CORS headers, state-changing foreign origins refused. */
export function crossOriginGuard(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (req.method !== 'GET' && req.method !== 'HEAD' && typeof origin === 'string' && origin !== '') {
    const host = req.headers.host ?? '';
    const proto = String(req.headers['x-forwarded-proto'] ?? req.protocol ?? 'http');
    let own: string;
    try {
      own = new URL(`${proto}://${host}`).origin;
    } catch {
      own = '';
    }
    if (origin !== own) {
      res.status(403).json({ error: { code: 'cross_origin', message: '' } });
      return;
    }
  }
  next();
}

export async function buildScope(req: CookiedRequest, res: Response, next: NextFunction): Promise<void> {
  const cookies = parseCookies(req.headers.cookie);
  req.cookies = cookies;
  const sessionToken = cookies.halide_session;
  const account = sessionToken ? await accountFromSession(sessionToken) : null;
  const locale = requestLocale(req, account);
  const scope: RequestScope = {
    locale,
    account,
    sessionId: sessionToken ?? '',
    requireAccount: () => {
      if (!account) throw unauthenticatedError();
      return account;
    },
    requireRole: (role: AccountRole) => {
      if (!account) throw unauthenticatedError();
      if (account.role !== role) throw forbiddenError();
      return account;
    },
    requirePatron: () => {
      if (!account) throw unauthenticatedError();
      if (account.role !== 'patron') throw forbiddenError();
      return account;
    },
    json: <T,>() => (req.jsonBody ?? {}) as T,
  };
  req.scope = scope;
  res.setHeader('X-Halide-Locale', locale);
  next();
}

export { notFoundError, crossOriginError };

/**
 * Anonymous guests get an HttpOnly cookie scoping their holds: the hold
 * request itself creates the session when none exists.
 */
export async function ensureHoldSession(
  req: CookiedRequest,
  res: Response,
  createSession: (accountId: number | null) => Promise<string>,
): Promise<string> {
  const scope = req.scope;
  if (!scope) throw notFoundError();
  if (scope.sessionId !== '') return scope.sessionId;
  const token = await createSession(null);
  scope.sessionId = token;
  res.setHeader('Set-Cookie', `halide_session=${token}; Path=/; HttpOnly; SameSite=Lax`);
  return token;
}
