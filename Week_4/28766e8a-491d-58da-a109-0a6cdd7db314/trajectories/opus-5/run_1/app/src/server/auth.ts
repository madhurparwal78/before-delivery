import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { IncomingMessage } from 'node:http';
import { query, queryOne } from './db.js';
import { newId } from './ids.js';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

export const SESSION_COOKIE = 'lw_session';

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Session {
  id: string;
  user: User;
}

interface UserRow extends Record<string, unknown> {
  id: string;
  email: string;
  name: string;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltPart, hashPart] = stored.split('$');
  if (scheme !== 'scrypt' || saltPart === undefined || hashPart === undefined) return false;
  const expected = Buffer.from(hashPart, 'base64');
  const derived = await scrypt(password, Buffer.from(saltPart, 'base64'), expected.length);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

export function sessionCookie(sessionId: string): string {
  return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function createSession(userId: string): Promise<string> {
  const id = randomBytes(24).toString('base64url');
  await query('INSERT INTO sessions (id, user_id) VALUES ($1, $2)', [id, userId]);
  return id;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}

export async function sessionFromRequest(request: IncomingMessage): Promise<Session | null> {
  const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
  if (token === undefined || token === '') return null;
  const row = await queryOne<UserRow>(
    `SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1`,
    [token],
  );
  if (!row) return null;
  return { id: token, user: { id: row.id, email: row.email, name: row.name } };
}

export async function findUserByEmail(email: string): Promise<(UserRow & { password_hash: string }) | undefined> {
  return queryOne<UserRow & { password_hash: string }>(
    'SELECT id, email, name, password_hash FROM users WHERE lower(email) = lower($1)',
    [email],
  );
}

export async function createUser(email: string, name: string, password: string): Promise<User> {
  const id = newId('u');
  await query('INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)', [
    id,
    email,
    name,
    await hashPassword(password),
  ]);
  return { id, email, name };
}
