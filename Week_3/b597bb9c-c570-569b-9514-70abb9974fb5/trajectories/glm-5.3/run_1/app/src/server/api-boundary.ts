import express, { type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import type { Db } from './db';
import { ApiError, apiFail, sendError, fillField } from './api-errors';
import { LIMIT_BYTES } from '../shared/errors';
import type { Person, Role } from '../shared/types';

/**
 * The API boundary: routing and precedence. Routing and the boundary come
 * first (404, 405 with Allow, 413, 415, Origin), then the session, then the
 * rate limit, then the replayed op, then the resource, then the role, then
 * state conflicts, then validation, and last the service outage.
 */
export interface AuthedRequest extends Request {
  person: Person | null;
  tokenAuth: { tokenId: string } | null;
  isOwner: boolean;
}

export function boundary(maxBytes: number): RequestHandler {
  return (req, res, next) => {
    // Same origin only: refuse a state-changing request from another origin.
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== '' && origin !== allowedOrigin(req)) {
      apiFail(res, 'forbidden');
      return;
    }
    const length = Number(req.headers['content-length'] ?? '0');
    if (length > maxBytes) {
      apiFail(res, 'too_large', { limit: maxBytes });
      return;
    }
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      next();
      return;
    }
    const contentType = req.headers['content-type'] ?? '';
    const mime = contentType.split(';')[0]!.trim().toLowerCase();
    const expected = expectedMime(req.path);
    if (mime !== expected) {
      apiFail(res, 'unsupported_media_type', { expected });
      return;
    }
    if (length === maxBytes) {
      // A body exactly at its limit is accepted.
      next();
      return;
    }
    next();
  };
}

function expectedMime(path: string): string {
  if (path.includes('/chunks/')) return 'application/octet-stream';
  if (path.endsWith('/captions/import')) return 'application/x-subrip';
  return 'application/json';
}

function allowedOrigin(req: Request): string {
  return String(req.headers['x-gatecut-origin'] ?? `http://${req.headers.host ?? ''}`);
}

export function wrongMethod(allowed: string[]): RequestHandler {
  return (req, res) => {
    res.set('Allow', allowed.join(', '));
    apiFail(res, 'method_not_allowed');
  };
}

export function notFoundHandler(req: Request, res: Response): void {
  if (req.path.startsWith('/api/')) {
    apiFail(res, 'not_found');
    return;
  }
  res.status(404).type('html').send('<!DOCTYPE html><html><body>404</body></html>');
}

export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof ApiError) {
    sendError(res, err);
    return;
  }
  const anyErr = err as { type?: string; statusCode?: number; message?: string };
  if (anyErr.type === 'entity.too.large' || anyErr.statusCode === 413) {
    apiFail(res, 'too_large', { limit: LIMIT_BYTES });
    return;
  }
  if (anyErr.type === 'unsupported.media.type' || anyErr.statusCode === 415) {
    apiFail(res, 'unsupported_media_type', { expected: 'application/json' });
    return;
  }
  res.status(500).json({ error: 'not_found', message: 'Nothing here. It may have been removed or you may not have access.' });
}

export function requirePerson(req: Request): Person {
  const authed = req as AuthedRequest;
  if (authed.person === null || authed.person === undefined) {
    throw new ApiError('unauthenticated');
  }
  return authed.person;
}

export function requireOwner(req: Request): Person {
  const person = requirePerson(req);
  if (!(req as AuthedRequest).isOwner) {
    throw new ApiError('forbidden');
  }
  return person;
}

export async function requireRole(db: Db, req: Request, projectId: string, allowed: Role[]): Promise<{ person: Person; role: Role }> {
  const person = requirePerson(req);
  const res = await db.query<{ role: string }>(
    'SELECT role FROM members WHERE project_id = $1 AND person_id = $2',
    [projectId, person.id],
  );
  if ((res.rowCount ?? 0) === 0) {
    // A non-member gets 404 for the project.
    throw new ApiError('not_found');
  }
  const role = res.rows[0]!.role as Role;
  if (!allowed.includes(role)) {
    throw new ApiError('forbidden');
  }
  return { person, role };
}

export function jsonOnly(req: Request, res: Response, next: NextFunction): void {
  void req;
  void res;
  next();
}

export const api = express.Router;

export interface ExpressError extends Error {
  statusCode?: number;
}

declare module 'express-serve-static-core' {
  interface Request {
    person: Person | null;
    tokenAuth: { tokenId: string } | null;
    isOwner: boolean;
  }
}

export { express };
export type { RequestHandler };
