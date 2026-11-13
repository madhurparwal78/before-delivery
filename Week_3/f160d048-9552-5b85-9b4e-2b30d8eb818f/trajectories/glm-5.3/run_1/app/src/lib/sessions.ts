import type { ServerResponse } from 'node:http';
import type { App, SessionUser } from './app.js';
import { randomToken, nowMs } from './clock.js';

const SESSION_MS = 30 * 24 * 3600 * 1000;
export const SESSION_COOKIE = 'cb_session';

export async function userFromSession(app: App, token: string | null): Promise<SessionUser | null> {
  if (!token) return null;
  const row = await app.db.one<{
    id: string;
    display_name: string;
    email: string;
    role: string;
    company_slug: string | null;
    unlocked: boolean;
    expires_at: Date;
  }>(
    `select u.id, u.display_name, u.email, u.role, u.unlocked, c.slug as company_slug, s.expires_at
     from sessions s
     join users u on u.id = s.user_id
     left join companies c on c.id = u.company_id
     where s.token = $1`,
    [token],
  );
  if (!row) return null;
  if (row.expires_at.getTime() <= nowMs()) {
    await app.db.query('delete from sessions where token = $1', [token]);
    return null;
  }
  return {
    id: row.id,
    display_name: row.display_name,
    email: row.email,
    role: row.role,
    company_slug: row.company_slug,
    unlocked: row.unlocked,
  };
}

export function cookieHeader(token: string | null): string {
  if (token === null) {
    return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}`;
}

export async function createSession(app: App, userId: string): Promise<string> {
  const token = randomToken();
  await app.db.query(
    'insert into sessions (token, user_id, expires_at) values ($1, $2, $3)',
    [token, userId, new Date(nowMs() + SESSION_MS)],
  );
  return token;
}

export function setSession(res: ServerResponse, token: string | null): void {
  res.setHeader('set-cookie', cookieHeader(token));
}
