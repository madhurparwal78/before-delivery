import type { IncomingMessage } from 'node:http';
import type { Db } from './db.js';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const SESSION_COOKIE = 'lw_session';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = createHash('sha256').update(`${salt}:${password}`).digest('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = createHash('sha256').update(`${salt}:${password}`).digest('hex');
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function createSession(db: Db, userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await db.query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, userId]);
  return token;
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE token = $1', [token]);
}

export async function sessionUser(db: Db, token: string | null): Promise<{ id: string; email: string; name: string } | null> {
  if (!token) return null;
  const result = await db.query(
    `SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1`,
    [token]);
  const row = result.rows[0] as { id: string; email: string; name: string } | undefined;
  return row ?? null;
}

export async function userFromRequest(db: Db, token: string | null): Promise<{ id: string; email: string; name: string } | null> {
  return sessionUser(db, token);
}

export function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
