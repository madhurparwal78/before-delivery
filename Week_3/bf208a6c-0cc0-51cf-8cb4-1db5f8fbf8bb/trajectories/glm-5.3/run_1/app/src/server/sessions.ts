import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import type { Db } from './db.js';

const SESSION_COOKIE = 'pinsheet_session';
const PASS_COOKIE = 'pinsheet_pass';
const secret = process.env.SESSION_SECRET ?? 'pinsheet-local-secret';

function sign(value: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function createSignedToken(value: string): string {
  return `${value}.${sign(value)}`;
}

export function verifySignedToken(token: string | undefined): string | null {
  if (!token) return null;
  const idx = token.lastIndexOf('.');
  if (idx === -1) return null;
  const value = token.slice(0, idx);
  const mac = token.slice(idx + 1);
  const expected = sign(value);
  try {
    if (mac.length === expected.length && timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) {
      return value;
    }
  } catch {
    return null;
  }
  return null;
}

export interface SessionUser {
  id: string;
  display_name: string;
  email: string;
}

export async function getUserBySessionToken(db: Db, cookieValue: string | undefined): Promise<SessionUser | null> {
  const raw = verifySignedToken(cookieValue);
  if (!raw?.startsWith('sess:')) return null;
  const res = await db.query(
    `SELECT u.id, u.display_name, u.email
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = $1 AND u.confirmed = true`,
    [raw],
  );
  return (res.rows[0] as SessionUser | undefined) ?? null;
}

export async function createSession(db: Db, userId: string): Promise<string> {
  const token = `sess:${randomUUID()}`;
  await db.query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, userId]);
  return createSignedToken(token);
}

export async function destroySession(db: Db, cookieValue: string | undefined): Promise<void> {
  const raw = verifySignedToken(cookieValue);
  if (!raw?.startsWith('sess:')) return;
  await db.query('DELETE FROM sessions WHERE token = $1', [raw]);
}

export { SESSION_COOKIE, PASS_COOKIE };
