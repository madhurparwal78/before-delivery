/** Password hashing and the Postgres-backed session cookie. */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { db, type Db } from '../db.js';
import type { Role, RenterStatus } from '../../shared/types.js';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 32;

export const SESSION_COOKIE = 'rs_session';

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const derived = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

export interface Principal {
  userId: string;
  name: string;
  email: string;
  role: Role;
  renterId: string | null;
  renterStatus: RenterStatus | null;
}

interface PrincipalRow {
  user_id: string;
  name: string;
  email: string;
  role: Role;
  renter_id: string | null;
  renter_status: RenterStatus | null;
}

export async function createSession(tx: Db, userId: string): Promise<string> {
  const id = randomBytes(32).toString('base64url');
  await tx.query('INSERT INTO sessions (id, user_id) VALUES ($1, $2)', [id, userId]);
  return id;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}

export async function principalForSession(sessionId: string): Promise<Principal | null> {
  const row = await db.maybeOne<PrincipalRow>(
    `SELECT u.id AS user_id, u.name, u.email, u.role, r.id AS renter_id, r.status AS renter_status
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN renters r ON r.user_id = u.id
      WHERE s.id = $1`,
    [sessionId],
  );
  if (!row) return null;
  return {
    userId: row.user_id,
    name: row.name,
    email: row.email,
    role: row.role,
    renterId: row.renter_id,
    renterStatus: row.renter_status,
  };
}

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const pair of header.split(';')) {
    const at = pair.indexOf('=');
    if (at === -1) continue;
    out[pair.slice(0, at).trim()] = decodeURIComponent(pair.slice(at + 1).trim());
  }
  return out;
}

export function sessionCookie(sessionId: string): string {
  return `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}
