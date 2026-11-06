import { config } from '../config';
import { query, queryOne, type PoolClient } from '../db';
import { randomToken, sessionIdValue, sha256Hex } from '../crypto';

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
}

export interface ActiveSession {
  user: SessionUser;
  csrfToken: string;
}

export type SessionLookup =
  | { state: 'none' }
  | { state: 'expired' }
  | { state: 'active'; session: ActiveSession };

interface SessionRow {
  id: string;
  user_id: string;
  csrf_token: string;
  created_at: Date;
  last_seen_at: Date;
  email: string;
  display_name: string;
}

export async function resolveSession(cookieValue: string | undefined): Promise<SessionLookup> {
  if (!cookieValue) return { state: 'none' };
  const row = await queryOne<SessionRow>(
    `select s.id, s.user_id, s.csrf_token, s.created_at, s.last_seen_at, u.email, u.display_name
     from sessions s join users u on u.id = s.user_id
     where s.id = $1`,
    [sha256Hex(cookieValue)],
  );
  if (!row) return { state: 'none' };
  const now = Date.now();
  const idleDeadline = row.last_seen_at.getTime() + config.sessionIdleSeconds * 1000;
  const absoluteDeadline = row.created_at.getTime() + config.sessionAbsoluteSeconds * 1000;
  if (now > idleDeadline || now > absoluteDeadline) return { state: 'expired' };
  return {
    state: 'active',
    session: {
      user: { id: row.user_id, email: row.email, displayName: row.display_name },
      csrfToken: row.csrf_token,
    },
  };
}

export async function touchSession(cookieValue: string): Promise<void> {
  await query('update sessions set last_seen_at = now() where id = $1', [sha256Hex(cookieValue)]);
}

export interface NewSession {
  cookieValue: string;
  csrfToken: string;
}

/**
 * Every sign-in, password change and account creation makes a new session and
 * deletes any session the request itself carried.
 */
export async function createSession(
  userId: string,
  carriedCookie: string | undefined,
  client?: PoolClient,
): Promise<NewSession> {
  const cookieValue = sessionIdValue();
  const csrfToken = randomToken();
  const run = async (text: string, values: unknown[]): Promise<void> => {
    if (client) await client.query(text, values);
    else await query(text, values);
  };
  if (carriedCookie) await run('delete from sessions where id = $1', [sha256Hex(carriedCookie)]);
  await run('insert into sessions (id, user_id, csrf_token) values ($1, $2, $3)', [
    sha256Hex(cookieValue),
    userId,
    csrfToken,
  ]);
  return { cookieValue, csrfToken };
}

export async function endAllSessions(userId: string, client?: PoolClient): Promise<void> {
  if (client) await client.query('delete from sessions where user_id = $1', [userId]);
  else await query('delete from sessions where user_id = $1', [userId]);
}

export function sessionCookieHeader(value: string): string {
  const attributes = ['HttpOnly'];
  if (config.secureCookies) attributes.push('Secure');
  attributes.push('SameSite=Lax', 'Path=/');
  return `${config.cookieName}=${value}; ${attributes.join('; ')}`;
}

export function clearedSessionCookieHeader(): string {
  const attributes = ['HttpOnly'];
  if (config.secureCookies) attributes.push('Secure');
  attributes.push('SameSite=Lax', 'Path=/', 'Max-Age=0');
  return `${config.cookieName}=; ${attributes.join('; ')}`;
}
