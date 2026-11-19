import express from 'express';
import { pool, q, one } from './db.js';
import { settings } from './settings.js';
import { clockNow } from './clock.js';
import { t, type ApiError } from './errors.js';

export type Auth = {
  userId: string;
  clinicId: string;
  role: string;
  name: string;
};

export async function currentUser(req: express.Request): Promise<Auth | null> {
  const token = readSessionCookie(req.headers.cookie);
  if (!token) return null;
  const row = await one(
    `select u.id, u.clinic_id, u.role, u.name, u.status from sessions s
     join users u on u.id = s.user_id where s.token = $1`,
    [token]
  );
  if (!row || row.status !== 'Active') return null;
  return { userId: row.id, clinicId: row.clinic_id, role: row.role, name: row.name };
}

function readSessionCookie(header?: string): string | null {
  if (!header) return null;
  const m = header.match(/(?:^|;\s*)rb_session=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function setSessionCookie(res: express.Response, token: string): void {
  res.setHeader('Set-Cookie', `rb_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`);
}

// ---- error sending -------------------------------------------------------

export function sendError(res: express.Response, err: ApiError): void {
  res.status(err.status).json(err.body);
}

// The single permission-check path used by every endpoint.
export function requireRole(role: string | null, allowed: string[]): void {
  if (!role || !allowed.includes(role)) throw t('forbidden');
}

export function safeLandingPath(next: string | undefined): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next[1] === '/' || next[1] === '\\') return '/today';
  if (/[\\]/.test(next) || /[\x00-\x1f]/.test(next)) return '/today';
  if (/:\/\//.test(next)) return '/today';
  return next;
}

export function isApiError(e: any): e is ApiError {
  return e && typeof e === 'object' && 'status' in e && 'body' in e && 'error' in e.body;
}

// handler wraps one endpoint: catches ApiError and dependency failures.
export function handler(fn: (req: express.Request, res: express.Response) => Promise<any>): express.RequestHandler {
  return async (req, res) => {
    try {
      const out = await fn(req, res);
      if (out !== undefined && out !== null) {
        res.status(out.status).json(out.body ?? {});
      }
    } catch (e: any) {
      if (isApiError(e)) return sendError(res, e);
      if (e instanceof SyntaxError && (req as any).body !== undefined) {
        return sendError(res, t('payload_too_large'));
      }
      // a storage client failure is an outage; a database failure is not
      if (e && e.name === 'StorageUnavailable') {
        return sendError(res, t('storage_unavailable'));
      }
      if (e && (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND' || e.code === 'ETIMEDOUT' || e.code === 'EPIPE')) {
        return sendError(res, t('database_unavailable'));
      }
      console.error('unhandled error', e);
      return sendError(res, t('database_unavailable'));
    }
  };
}
