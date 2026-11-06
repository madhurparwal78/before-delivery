import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';

import type { Role } from '../../shared/api.js';
import type { Database } from '../db/pool.js';
import type { SessionUser } from './context.js';

export const SESSION_COOKIE = 'passboard_session';

interface SessionRow {
  id: string;
  role: Role;
  name: string;
  email: string;
  member_id: string | null;
  business_name: string | null;
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return null;
}

export function setSessionCookie(res: Response, token: string): void {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/`,
  );
}

export function clearSessionCookie(res: Response): void {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
  );
}

export async function createSession(db: Database, userId: string, now: Date): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.query('INSERT INTO sessions (token, user_id, created_at) VALUES ($1, $2, $3)', [
    token,
    userId,
    now,
  ]);
  return token;
}

export async function destroySession(db: Database, token: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE token = $1', [token]);
}

export async function loadSessionUser(
  db: Database,
  token: string | null,
): Promise<SessionUser | null> {
  if (token === null) return null;
  const result = await db.query<SessionRow>(
    `SELECT u.id, u.role, u.name, u.email, u.member_id, m.business_name
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN members m ON m.id = u.member_id
      WHERE s.token = $1`,
    [token],
  );
  const row = result.rows[0];
  return row === undefined ? null : row;
}
