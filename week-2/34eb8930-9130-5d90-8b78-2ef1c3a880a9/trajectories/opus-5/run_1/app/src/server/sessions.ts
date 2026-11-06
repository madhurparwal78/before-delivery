import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { query } from './db.js';
import { type PersonRecord, personById } from './people.js';

export const SESSION_COOKIE = 'qd_session';
const SESSION_HOURS = 12;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function passwordMatches(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split(':');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, actual);
}

export async function startSession(personId: string): Promise<string> {
  const id = randomBytes(24).toString('base64url');
  await query(`insert into sessions (id, person_id, expires_at) values ($1, $2, now() + interval '${SESSION_HOURS} hours')`, [
    id,
    personId,
  ]);
  return id;
}

export async function endSession(sessionId: string): Promise<void> {
  await query('delete from sessions where id = $1', [sessionId]);
}

export async function personForSession(sessionId: string | null): Promise<PersonRecord | null> {
  if (!sessionId) return null;
  const result = await query<{ person_id: string }>('select person_id from sessions where id = $1 and expires_at > now()', [
    sessionId,
  ]);
  const row = result.rows[0];
  if (!row) return null;
  return personById(row.person_id);
}

export function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function sessionCookie(id: string): string {
  return `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}`;
}

export function clearedCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
