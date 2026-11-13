import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Queryable } from '../db.js';
import { instantOf, instantParam, maybeInstant } from '../db.js';
import type { Member } from './context.js';
import { sessionEnded, unauthenticated } from './errors.js';
import { copy } from '../../shared/copy.js';
import type { Role } from '../../shared/options.js';

export const SESSION_COOKIE = 'ourlet_session';

const SCRYPT_KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(password, salt, SCRYPT_KEY_LENGTH).toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [, salt, digest] = stored.split('$');
  if (salt === undefined || digest === undefined) return false;
  const expected = Buffer.from(digest, 'hex');
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** The session cookie: HttpOnly, SameSite Lax, path `/`, with no Max-Age or Expires. */
export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}

interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: string;
  created_at: string;
  removed_at: string | null;
}

export function memberOf(row: MemberRow): Member {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role as Role,
    createdAt: instantOf(row.created_at),
  };
}

export async function createSession(
  db: Queryable,
  memberId: string,
  now: number,
  sessionSeconds: number,
): Promise<string> {
  const token = newToken();
  await db.query(
    `INSERT INTO sessions (token, member_id, created_at, expires_at) VALUES ($1, $2, $3, $4)`,
    [token, memberId, instantParam(now), instantParam(now + sessionSeconds * 1_000)],
  );
  return token;
}

export async function endSession(db: Queryable, token: string, now: number): Promise<void> {
  await db.query(`UPDATE sessions SET ended_at = $2 WHERE token = $1 AND ended_at IS NULL`, [
    token,
    instantParam(now),
  ]);
}

/**
 * Step 4: 401 `unauthenticated` for no or unknown session, 401 `session_ended` for an
 * ended one. A removed member's sessions have ended.
 */
export async function authenticate(
  db: Queryable,
  token: string | undefined,
  now: number,
): Promise<Member> {
  if (token === undefined || token === '') throw unauthenticated();
  const { rows } = await db.query<{
    expires_at: string;
    ended_at: string | null;
    id: string;
    name: string;
    email: string;
    role: string;
    created_at: string;
    removed_at: string | null;
  }>(
    `SELECT s.expires_at, s.ended_at, m.id, m.name, m.email, m.role, m.created_at, m.removed_at
       FROM sessions s JOIN members m ON m.id = s.member_id
      WHERE s.token = $1`,
    [token],
  );
  const row = rows[0];
  if (row === undefined) throw unauthenticated();
  const expired = instantOf(row.expires_at) <= now;
  const ended = maybeInstant(row.ended_at) !== null;
  if (expired || ended || row.removed_at !== null) throw sessionEnded(copy.sessionEnded);
  return memberOf(row);
}
