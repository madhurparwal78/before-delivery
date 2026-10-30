import type { Request, Response } from 'express';
import type { Role } from '../../shared/types.js';
import { pool, queryOne } from '../db/pool.js';
import { newSessionId } from '../domain/secrets.js';

export const SESSION_COOKIE = 'pl_session';
const SESSION_DAYS = 30;

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  kitchen_id: string;
  member_id: string | null;
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

export async function startSession(userId: string, now: Date): Promise<string> {
  const id = newSessionId();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400000);
  await pool.query(
    'INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)',
    [id, userId, now, expires],
  );
  return id;
}

export async function endSession(req: Request): Promise<void> {
  const id = readCookie(req, SESSION_COOKIE);
  if (id) await pool.query('DELETE FROM sessions WHERE id = $1', [id]);
}

export async function sessionUser(req: Request, now: Date): Promise<SessionUser | null> {
  const id = readCookie(req, SESSION_COOKIE);
  if (!id) return null;
  return queryOne<SessionUser>(
    pool,
    `SELECT u.id, u.name, u.email, u.role, u.kitchen_id, u.member_id
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > $2`,
    [id, now],
  );
}

export function setSessionCookie(res: Response, id: string): void {
  res.append(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`,
  );
}

export function clearSessionCookie(res: Response): void {
  res.append('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}
