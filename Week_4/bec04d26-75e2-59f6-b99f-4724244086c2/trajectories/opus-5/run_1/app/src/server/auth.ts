import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Role, User } from '../shared/types';
import { config } from './config';
import { query, queryOne, Tx } from './db';

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 32;

export const SESSION_COOKIE = 'duefield_session';

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return `scrypt$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const derived = (await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length)) as Buffer;
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

export interface UserRow {
  id: string;
  practice_id: string;
  display_name: string;
  email: string;
  password_hash: string;
  role: Role;
  client_id: string | null;
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    display_name: row.display_name,
    email: row.email,
    role: row.role,
    client_id: row.client_id,
  };
}

export async function createSession(userId: string, tx?: Tx): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const expires = Date.now() + config.sessionTtlSeconds * 1000;
  const sql = 'INSERT INTO sessions (token, user_id, expires_ms) VALUES ($1,$2,$3)';
  if (tx) await tx.query(sql, [token, userId, expires]);
  else await query(sql, [token, userId, expires]);
  return token;
}

export async function destroySession(token: string): Promise<void> {
  await query('DELETE FROM sessions WHERE token = $1', [token]);
}

export async function userForToken(token: string | null): Promise<UserRow | null> {
  if (!token) return null;
  return queryOne<UserRow>(
    `SELECT u.id, u.practice_id, u.display_name, u.email, u.password_hash, u.role, u.client_id
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = $1 AND s.expires_ms > $2`,
    [token, Date.now()],
  );
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${config.sessionTtlSeconds}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

export function newId(): string {
  return randomUUID();
}
