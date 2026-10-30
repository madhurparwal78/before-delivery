import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Role, SessionUser } from '../../shared/types.js';
import { pool, query, queryOne } from '../db/pool.js';
import { env } from '../env.js';

export const SESSION_COOKIE = 'hs_session';
const SESSION_DAYS = 30;

let signingSecret = env.sessionSecret;

/** Generated once and kept in Postgres, so sessions outlive a restart. */
export async function loadSessionSecret(): Promise<void> {
  if (process.env.SESSION_SECRET !== undefined && process.env.SESSION_SECRET !== '') return;
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ('session_secret', $1) ON CONFLICT (key) DO NOTHING`,
    [env.sessionSecret],
  );
  const row = await queryOne<{ value: string }>(
    pool,
    `SELECT value FROM app_settings WHERE key = 'session_secret'`,
  );
  if (row !== null) signingSecret = row.value;
}

export interface Actor extends SessionUser {
  sessionId: string;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function passwordMatches(password: string, stored: string): boolean {
  const [salt, digest] = stored.split(':');
  if (salt === undefined || digest === undefined) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(digest, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function sign(sessionId: string): string {
  return createHmac('sha256', signingSecret).update(sessionId).digest('base64url');
}

export function cookieValue(sessionId: string): string {
  return `${sessionId}.${sign(sessionId)}`;
}

export function readCookie(req: IncomingMessage, name: string): string | null {
  const header = req.headers.cookie;
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  operator_id: string;
  renter_id: string | null;
  site_id: string | null;
}

async function siteIdsFor(user: UserRow): Promise<string[]> {
  if (user.site_id !== null) return [user.site_id];
  const rows = await query<{ id: string }>(
    pool,
    'SELECT id FROM sites WHERE operator_id = $1 ORDER BY sort_order',
    [user.operator_id],
  );
  return rows.map((row) => row.id);
}

export async function createSession(userId: string): Promise<string> {
  const sessionId = `se-${randomBytes(18).toString('hex')}`;
  await pool.query(
    `INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, now() + ($3 || ' days')::interval)`,
    [sessionId, userId, String(SESSION_DAYS)],
  );
  return sessionId;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}

export async function actorFromRequest(req: IncomingMessage): Promise<Actor | null> {
  const raw = readCookie(req, SESSION_COOKIE);
  if (raw === null) return null;
  const separator = raw.lastIndexOf('.');
  if (separator <= 0) return null;
  const sessionId = raw.slice(0, separator);
  if (raw.slice(separator + 1) !== sign(sessionId)) return null;
  const row = await queryOne<UserRow>(
    pool,
    `SELECT u.id, u.name, u.email, u.role, u.operator_id, u.renter_id, u.site_id
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > now()`,
    [sessionId],
  );
  if (!row) return null;
  return {
    sessionId,
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    operator_id: row.operator_id,
    site_ids: await siteIdsFor(row),
    renter_id: row.renter_id,
  };
}

export function publicUser(actor: Actor): SessionUser {
  return {
    id: actor.id,
    name: actor.name,
    email: actor.email,
    role: actor.role,
    operator_id: actor.operator_id,
    site_ids: actor.site_ids,
    renter_id: actor.renter_id,
  };
}
