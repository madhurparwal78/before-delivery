import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import type { UserRecord } from '../db/users.js';
import { languagesOf } from '../db/users.js';
import type { Viewer } from '../domain/records.js';

export const SESSION_COOKIE = 'teamseat_session';

export interface SessionRecord {
  id: string;
  user: UserRecord;
  languages: string[];
}

export function viewerOf(session: SessionRecord): Viewer {
  return {
    id: session.user.id,
    role: session.user.role,
    orgId: session.user.org_id,
    languages: session.languages,
  };
}

export async function createSession(userId: number): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    "INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, now() + ($3 || ' seconds')::interval)",
    [token, userId, String(config.sessionTtlSeconds)],
  );
  return token;
}

export async function destroySession(token: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE id = $1', [token]);
}

export async function loadSession(token: string): Promise<SessionRecord | null> {
  const result = await pool.query<UserRecord>(
    `SELECT u.id, u.name, u.email, u.role, u.org_id, o.code AS org_code, o.name AS org_name, u.phone, u.initials
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN orgs o ON o.id = u.org_id
     WHERE s.id = $1 AND s.expires_at > now() AND u.active`,
    [token],
  );
  const user = result.rows[0];
  if (user === undefined) {
    return null;
  }
  return { id: token, user, languages: await languagesOf(pool, user.id) };
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (header === undefined) {
    return cookies;
  }
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0) {
      cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return cookies;
}

export function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.sessionTtlSeconds}`;
}

export function clearedCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
