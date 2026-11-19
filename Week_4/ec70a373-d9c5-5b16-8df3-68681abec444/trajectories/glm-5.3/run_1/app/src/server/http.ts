import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { SessionUser } from './context.js';
import { ApiError } from './errors.js';
import { jsonError, validationError } from './errors.js';
import type { Json, Role } from '../types.js';
import { httpDate } from '../clock.js';

export interface AuthedRequest extends Request {
  user?: SessionUser;
  rawBody?: Buffer;
  authFailure?: 'session_expired' | 'session_invalid';
}

export function asyncHandler(
  handler: (req: AuthedRequest, res: Response) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    handler(req as AuthedRequest, res as Response).catch(next);
  };
}

export function requireRoles(...roles: Role[]): RequestHandler {
  return (req, res, next) => {
    const user = (req as AuthedRequest).user;
    if (!user) {
      next(new ApiError(401, 'unauthenticated', 'Sign in to continue.'));
      return;
    }
    if (!roles.includes(user.role)) {
      next(new ApiError(403, 'forbidden', 'Your role cannot use this endpoint.'));
      return;
    }
    next();
  };
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(name + '=')) {
      return decodeURIComponent(trimmed.slice(name.length + 1));
    }
  }
  return null;
}

export function cookieAttributes(secure: boolean): string {
  return secure ? '; Path=/; HttpOnly; SameSite=Strict; Secure' : '; Path=/; HttpOnly; SameSite=Strict';
}

export function csrfCookieAttributes(secure: boolean): string {
  return secure ? '; Path=/; SameSite=Strict; Secure' : '; Path=/; SameSite=Strict';
}

/** The client's IPv4 address with the last octet zeroed, or null for IPv6-only peers. */
export function addressPrefix(req: Request): string | null {
  const raw = req.socket.remoteAddress ?? '';
  let v4 = raw;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(raw);
  if (mapped) v4 = mapped[1];
  const parts = v4.split('.');
  if (parts.length === 4 && parts.every((part) => /^\d+$/.test(part))) {
    return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  }
  return null;
}

export function peerAddress(req: Request): string {
  const raw = req.socket.remoteAddress ?? '';
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(raw);
  return mapped ? mapped[1] : raw;
}

/** The server's own origin for a request: its scheme, then its Host header exactly as sent. */
export function originOf(req: Request): string {
  const proto = (req.headers['x-forwarded-proto'] === 'https' || (req.socket as { encrypted?: boolean }).encrypted) ? 'https' : 'http';
  return `${proto}://${req.headers.host ?? ''}`;
}

export function isJsonContent(req: Request): boolean {
  const type = req.headers['content-type'] ?? '';
  return type.split(';')[0].trim() === 'application/json';
}

export function sendApiError(res: Response, err: ApiError): void {
  jsonError(res, err);
}

export function requireJsonBody(req: AuthedRequest): Record<string, Json> {
  const body = req.body;
  if (body === undefined || body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw validationError({ body: 'Send a JSON object.' });
  }
  return body as Record<string, Json>;
}

export function serverNowDate(): string {
  return httpDate();
}

export function attachCommonHeaders(res: Response): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Date', httpDate());
}
