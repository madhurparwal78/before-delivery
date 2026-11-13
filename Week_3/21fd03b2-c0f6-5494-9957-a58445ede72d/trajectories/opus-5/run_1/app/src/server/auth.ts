import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { one, query } from './db.js';
import { newId } from './ids.js';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

export const SESSION_COOKIE = 'rw_session';

export interface Account {
  id: string;
  email: string;
  displayName: string;
}

export function foldEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltText, hashText] = stored.split('$');
  if (scheme !== 'scrypt' || !saltText || !hashText) return false;
  const derived = await scryptAsync(password, Buffer.from(saltText, 'base64'), 64);
  const expected = Buffer.from(hashText, 'base64');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export async function createSession(userId: string): Promise<string> {
  const id = `${newId()}${newId()}`;
  await query('insert into sessions (id, user_id) values ($1, $2)', [id, userId]);
  return id;
}

export async function dropSession(sessionId: string): Promise<void> {
  await query('delete from sessions where id = $1', [sessionId]);
}

export async function accountForSession(sessionId: string): Promise<Account | null> {
  const row = await one<{ id: string; email: string; display_name: string }>(
    `select a.id, a.email, a.display_name
       from sessions s join accounts a on a.id = s.user_id
      where s.id = $1`,
    [sessionId],
  );
  return row ? { id: row.id, email: row.email, displayName: row.display_name } : null;
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

export function sessionCookie(sessionId: string): string {
  return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
