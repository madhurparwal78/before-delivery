/** Staff sign-in, the session cookie and session expiry. */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { query } from './db';
import { loadConfig } from './config';
import { getSessionSigningKey } from './secrets';
import { isStaffSessionExpired } from '../domain/staffSession';
import { StaffRole } from '../domain/stateMachine';

const config = loadConfig();

export const SESSION_COOKIE = 'tw_session';

export interface StaffUser {
  id: string;
  name: string;
  email: string;
  roles: StaffRole[];
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1] as string, 'hex');
  const expected = Buffer.from(parts[2] as string, 'hex');
  const derived = scryptSync(password, salt, expected.length);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

function signSessionId(sessionId: string): string {
  const signature = createHmac('sha256', getSessionSigningKey()).update(sessionId).digest('hex');
  return `${sessionId}.${signature}`;
}

function readSessionId(cookieValue: string | undefined): string | null {
  if (typeof cookieValue !== 'string') return null;
  const separator = cookieValue.lastIndexOf('.');
  if (separator <= 0) return null;
  const sessionId = cookieValue.slice(0, separator);
  const provided = cookieValue.slice(separator + 1);
  const expected = createHmac('sha256', getSessionSigningKey()).update(sessionId).digest('hex');
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(expected, 'utf8'))) return null;
  return sessionId;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  roles: string[];
  password_hash: string;
}

export async function signIn(
  email: string,
  password: string,
): Promise<{ user: StaffUser; cookieValue: string } | null> {
  const rows = await query<UserRow>(
    'SELECT id, name, email, roles, password_hash FROM staff_user WHERE lower(email) = lower($1)',
    [email],
  );
  const row = rows[0];
  if (!row || !verifyPassword(password, row.password_hash)) return null;
  const sessionId = randomBytes(24).toString('hex');
  const now = new Date();
  await query(
    'INSERT INTO staff_session (id, user_id, created_at, last_request_at, ended) VALUES ($1, $2, $3, $3, false)',
    [sessionId, row.id, now],
  );
  return {
    user: { id: row.id, name: row.name, email: row.email, roles: row.roles as StaffRole[] },
    cookieValue: signSessionId(sessionId),
  };
}

export async function authenticate(cookieValue: string | undefined): Promise<StaffUser | null> {
  const sessionId = readSessionId(cookieValue);
  if (sessionId === null) return null;
  const rows = await query<{
    user_id: string;
    name: string;
    email: string;
    roles: string[];
    last_request_at: Date;
    ended: boolean;
  }>(
    `SELECT s.user_id, u.name, u.email, u.roles, s.last_request_at, s.ended
       FROM staff_session s JOIN staff_user u ON u.id = s.user_id
      WHERE s.id = $1`,
    [sessionId],
  );
  const row = rows[0];
  if (!row || row.ended) return null;
  if (
    isStaffSessionExpired(row.last_request_at.getTime(), Date.now(), config.staffSessionIdleSeconds)
  ) {
    await query('UPDATE staff_session SET ended = true WHERE id = $1', [sessionId]);
    return null;
  }
  await query('UPDATE staff_session SET last_request_at = $2 WHERE id = $1', [sessionId, new Date()]);
  return { id: row.user_id, name: row.name, email: row.email, roles: row.roles as StaffRole[] };
}

export async function signOut(cookieValue: string | undefined): Promise<void> {
  const sessionId = readSessionId(cookieValue);
  if (sessionId === null) return;
  await query('UPDATE staff_session SET ended = true WHERE id = $1', [sessionId]);
}

export function sessionCookieHeader(cookieValue: string): string {
  return `${SESSION_COOKIE}=${cookieValue}; HttpOnly; SameSite=Lax; Path=/`;
}

export function clearedSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}
