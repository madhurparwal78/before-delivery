import type { NextFunction, Request, Response } from 'express';
import { pool } from './db.js';
import { hashToken, newToken } from './ids.js';
import { unauthenticated } from './errors.js';
import type { User } from '../shared/protocol.js';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  verified: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const SESSION_COOKIE = 'wb_session';

export async function createSession(userId: string, days = 30): Promise<string> {
  const token = newToken(24);
  await pool.query('INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + ($3 || \' days\')::interval)', [
    hashToken(token),
    userId,
    days,
  ]);
  return token;
}

export async function userFromSession(token: string | undefined): Promise<AuthUser | null> {
  if (!token) return null;
  const r = await pool.query<{ id: string; email: string; display_name: string; verified: boolean }>(
    `SELECT u.id, u.email, u.display_name, u.verified
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  const row = r.rows[0];
  return row ? { id: row.id, email: row.email, displayName: row.display_name, verified: row.verified } : null;
}

/** Attaches req.user when a valid session cookie is present; never rejects (DP-04 precedence). */
export async function attachUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE];
  try {
    req.user = (await userFromSession(token)) ?? undefined;
  } catch {
    req.user = undefined;
  }
  next();
}

export function requireUser(req: Request): AuthUser {
  if (!req.user) throw unauthenticated();
  return req.user;
}

export function toProtocolUser(u: AuthUser): User {
  return { id: u.id, email: u.email, displayName: u.displayName, verified: u.verified };
}
