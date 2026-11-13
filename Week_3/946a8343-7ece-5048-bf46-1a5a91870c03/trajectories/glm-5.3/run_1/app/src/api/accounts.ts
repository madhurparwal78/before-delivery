import { AppError } from '../core/errors.js';
import type { RequestCtx } from './ctx.js';
import { requireBody } from './ctx.js';
import * as errs from './errors.js';
import { hashPassword, verifyPassword, newSessionToken } from '../services/passwords.js';
import { ianaZoneOk } from '../core/util.js';

export const USERNAME_RE = /^[a-z0-9_]{3,24}$/;

export function userBody(u: { id: number; username: string; time_zone: string }): Record<string, unknown> {
  return { id: u.id, username: u.username, time_zone: u.time_zone };
}

export async function createUser(rc: RequestCtx): Promise<unknown> {
  const body = requireBody(rc);
  const username = typeof body.username === 'string' ? body.username.toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const fields: Record<string, string> = {};
  if (!USERNAME_RE.test(username)) fields.username = 'Username must be 3 to 24 characters: a-z, 0-9 and _.';
  if (password.length < 8) fields.password = 'Password must be at least 8 characters.';
  if (Object.keys(fields).length > 0) throw errs.validation(fields);
  const existing = await rc.ctx.db.query(`SELECT id FROM users WHERE username = $1`, [username]);
  if (existing.rows.length > 0) {
    throw new AppError(409, 'username_taken', 'That username is taken.', { fields: { username: 'That username is taken.' } });
  }
  const now = rc.ctx.now();
  const r = await rc.ctx.db.query<{ id: number; username: string; time_zone: string }>(
    `INSERT INTO users (username, password_hash, time_zone, created_at) VALUES ($1, $2, 'UTC', $3) RETURNING id, username, time_zone`,
    [username, hashPassword(password), now],
  );
  const user = r.rows[0];
  const token = newSessionToken();
  await rc.ctx.db.query(`INSERT INTO sessions (token, user_id, created_at, last_used) VALUES ($1, $2, $3, $3)`, [token, user.id, now]);
  setSessionCookie(rc, token);
  return { user: userBody(user) };
}

export function setSessionCookie(rc: RequestCtx, token: string): void {
  rc.res.setHeader('Set-Cookie', `spur_session=${token}; HttpOnly; SameSite=Lax; Path=/`);
}

export async function signIn(rc: RequestCtx): Promise<unknown> {
  const body = requireBody(rc);
  const username = typeof body.username === 'string' ? body.username.toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const now = rc.ctx.now();
  const { checkLoginRate } = await import('./http.js');
  const client = await rc.ctx.db.pool.connect();
  try {
    const secs = await checkLoginRate(client, username, rc.ctx.settings.loginRate, now);
    if (secs !== null) throw errs.rateLimited(secs);
    const r = await client.query<{ id: number; username: string; time_zone: string; password_hash: string }>(
      `SELECT id, username, time_zone, password_hash FROM users WHERE username = $1`, [username],
    );
    const user = r.rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new AppError(401, 'bad_credentials', 'Username or password is wrong.', { fields: { password: 'Username or password is wrong.' } });
    }
    const token = newSessionToken();
    await client.query(`INSERT INTO sessions (token, user_id, created_at, last_used) VALUES ($1, $2, $3, $3)`, [token, user.id, now]);
    setSessionCookie(rc, token);
    return { user: userBody(user) };
  } finally {
    client.release();
  }
}

export async function signOut(rc: RequestCtx): Promise<unknown> {
  const cookies = rc.req.headers.cookie ?? '';
  const token = /(?:^|;\s*)spur_session=([^;]+)/.exec(cookies)?.[1] ?? null;
  if (token) {
    await rc.ctx.db.query(`DELETE FROM sessions WHERE token = $1`, [token]);
  }
  rc.res.setHeader('Set-Cookie', 'spur_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  return null;
}

export async function me(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  return { user: userBody(rc.user) };
}

export async function updateMe(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const body = requireBody(rc);
  const tz = typeof body.time_zone === 'string' ? body.time_zone : '';
  if (!ianaZoneOk(tz)) {
    throw errs.validation({ time_zone: `Unknown time zone ${tz}.` });
  }
  await rc.ctx.db.query(`UPDATE users SET time_zone = $2 WHERE id = $1`, [rc.user.id, tz]);
  return { user: { id: rc.user.id, username: rc.user.username, time_zone: tz } };
}
