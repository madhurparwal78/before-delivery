import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { Db, one } from '../db';
import { Role, isRole } from '../domain/roles';

export const SESSION_COOKIE = 'nightroll_session';

const SCRYPT_KEY_LENGTH = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, SCRYPT_KEY_LENGTH);
  return `scrypt:${salt.toString('hex')}:${derived.toString('hex')}`;
}

export function passwordMatches(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const derived = scryptSync(password, salt, expected.length);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  hotelId: string;
  sessionId: string;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const jar: Record<string, string> = {};
  if (!header) return jar;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    jar[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return jar;
}

interface SessionRow {
  id: string;
  email: string;
  name: string;
  role: string;
  hotel_id: string;
  session_id: string;
}

export async function loadSession(db: Db, sessionId: string | undefined): Promise<SessionUser | null> {
  if (!sessionId) return null;
  const row = await one<SessionRow>(
    db,
    `select u.id, u.email, u.name, u.role, u.hotel_id, s.id as session_id
       from sessions s join users u on u.id = s.user_id
      where s.id = $1`,
    [sessionId],
  );
  if (!row || !isRole(row.role)) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    hotelId: row.hotel_id,
    sessionId: row.session_id,
  };
}

export async function createSession(db: Db, userId: string): Promise<string> {
  const id = randomUUID();
  await db.query('insert into sessions (id, user_id) values ($1, $2)', [id, userId]);
  return id;
}

export async function deleteSession(db: Db, sessionId: string): Promise<void> {
  await db.query('delete from sessions where id = $1', [sessionId]);
}

export function sessionCookieHeader(sessionId: string): string {
  return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearedCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
