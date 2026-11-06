import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Role } from '../shared/domain.ts';
import type { Queryable } from './db.ts';

export const SESSION_COOKIE = 'strata_session';
const SCRYPT_KEY_LENGTH = 32;

export interface Actor {
  userId: string;
  name: string;
  email: string;
  role: Role;
  tokenHash: string;
}

/** Passwords are stored only as salted scrypt hashes. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, SCRYPT_KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const derived = scryptSync(password, Buffer.from(saltHex, 'hex'), SCRYPT_KEY_LENGTH);
  const expected = Buffer.from(hashHex, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** A session token is 256 bits of randomness; the database stores only its SHA-256. */
export function newSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    cookies.set(part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim()));
  }
  return cookies;
}

/** Reads the actor's session and role from the database, so a role change applies at once. */
export async function actorForToken(client: Queryable, tokenHash: string): Promise<Actor | null> {
  const result = await client.query<{
    user_id: string;
    name: string;
    email: string;
    role: Role;
  }>(
    `SELECT u.id AS user_id, u.name, u.email, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1`,
    [tokenHash],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { userId: row.user_id, name: row.name, email: row.email, role: row.role, tokenHash };
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}
