import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { Request, Response } from 'express';
import { query, queryOne } from './db';

export const SESSION_COOKIE = 'jarful_session';

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  confirmed: boolean;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 32).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 3) return false;
  const derived = scryptSync(password, parts[1], 32);
  const expected = Buffer.from(parts[2], 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function newSignupCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export async function createSession(userId: string): Promise<string> {
  const id = randomBytes(24).toString('hex');
  await query('insert into sessions (id, user_id) values ($1, $2)', [id, userId]);
  return id;
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function setSessionCookie(res: Response, sessionId: string): void {
  res.cookie(SESSION_COOKIE, sessionId, { httpOnly: true, sameSite: 'lax', path: '/' });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/' });
}

export async function currentUser(req: Request): Promise<UserRow | null> {
  const sessionId = readCookie(req, SESSION_COOKIE);
  if (!sessionId) return null;
  return queryOne<UserRow>(
    `select users.id, users.email, users.name, users.password_hash, users.confirmed
     from sessions join users on users.id = sessions.user_id
     where sessions.id = $1`,
    [sessionId],
  );
}

export async function endSession(req: Request): Promise<void> {
  const sessionId = readCookie(req, SESSION_COOKIE);
  if (sessionId) await query('delete from sessions where id = $1', [sessionId]);
}
