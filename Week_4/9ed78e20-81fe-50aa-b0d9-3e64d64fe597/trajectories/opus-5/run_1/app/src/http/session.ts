import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { config } from '../config.js';
import { query, type Queryable } from '../db/pool.js';

export const SESSION_COOKIE = 'aor_session';

const SCRYPT_KEYLEN = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || saltHex === undefined || hashHex === undefined) return false;
  const derived = scryptSync(password, Buffer.from(saltHex, 'hex'), SCRYPT_KEYLEN);
  const expected = Buffer.from(hashHex, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export type SignedInStaff = { readonly email: string; readonly name: string };

export function readCookie(headers: IncomingHttpHeaders, name: string): string | null {
  const header = headers.cookie;
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return null;
}

export function sessionCookie(id: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${config.sessionTtlSeconds}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

export async function createSession(email: string): Promise<string> {
  const id = randomBytes(32).toString('base64url');
  await query(
    `INSERT INTO sessions (id, staff_email, created_at, expires_at)
     VALUES ($1, $2, now(), now() + ($3 || ' seconds')::interval)`,
    [id, email, String(config.sessionTtlSeconds)],
  );
  return id;
}

export async function loadSession(
  tx: Queryable,
  headers: IncomingHttpHeaders,
): Promise<SignedInStaff | null> {
  const id = readCookie(headers, SESSION_COOKIE);
  if (id === null) return null;
  const result = await tx.query<{ email: string; name: string }>(
    `SELECT s.email, s.name FROM sessions sess
       JOIN staff s ON s.email = sess.staff_email
      WHERE sess.id = $1 AND sess.expires_at > now()`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function destroySession(headers: IncomingHttpHeaders): Promise<void> {
  const id = readCookie(headers, SESSION_COOKIE);
  if (id === null) return;
  await query('DELETE FROM sessions WHERE id = $1', [id]);
}
