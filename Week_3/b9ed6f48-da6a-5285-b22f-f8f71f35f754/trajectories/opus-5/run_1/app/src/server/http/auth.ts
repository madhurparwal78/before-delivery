import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { pool, queryOne } from '../db/index.js';
import { AppError } from '../errors.js';
import type { Role, User } from '../../shared/types.js';

export const SESSION_COOKIE = 'sl_session';

declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
  }
}

interface SessionRow {
  user_id: string;
  name: string;
  email: string;
  role: Role;
}

export async function startSession(response: Response, user: User): Promise<void> {
  const id = randomBytes(24).toString('base64url');
  await pool.query(
    `INSERT INTO sign_in_sessions (id, user_id, name, email, role) VALUES ($1, $2, $3, $4, $5)`,
    [id, user.id, user.name, user.email, user.role],
  );
  response.cookie(SESSION_COOKIE, id, { httpOnly: true, sameSite: 'lax', path: '/' });
}

export async function endSession(request: Request, response: Response): Promise<void> {
  const id = readCookie(request);
  if (id) await pool.query('DELETE FROM sign_in_sessions WHERE id = $1', [id]);
  response.clearCookie(SESSION_COOKIE, { path: '/' });
}

function readCookie(request: Request): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/** Attaches the user of this request's own session cookie, and no one else's. */
export async function attachUser(request: Request, _response: Response, next: NextFunction): Promise<void> {
  try {
    const id = readCookie(request);
    if (!id) {
      next();
      return;
    }
    const row = await queryOne<SessionRow>(
      'SELECT user_id, name, email, role FROM sign_in_sessions WHERE id = $1',
      [id],
    );
    if (row) request.user = { id: row.user_id, name: row.name, email: row.email, role: row.role };
    next();
  } catch (error) {
    next(error);
  }
}

export function requireUser(request: Request): User {
  if (!request.user) throw new AppError('unauthenticated');
  return request.user;
}

export function requireRole(request: Request, roles: Role[]): User {
  const user = requireUser(request);
  if (!roles.includes(user.role)) throw new AppError('forbidden');
  return user;
}

export function requireCurator(request: Request): User {
  return requireRole(request, ['curator', 'lead_curator']);
}

export function requireManager(request: Request): User {
  return requireRole(request, ['manager']);
}
