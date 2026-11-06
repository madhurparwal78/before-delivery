import { randomBytes } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { pool, queryOne } from '../db/pool';
import { AuthUser } from './context';
import { fail } from './errors';

/** The shared demo passcode is public by design, as are the seeded accounts. */
export const DEMO_PASSCODE = 'weave-demo-2026';
export const SESSION_COOKIE = 'sw_session';

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export async function signIn(email: string, passcode: string): Promise<{ user: AuthUser; token: string }> {
  const user = await queryOne<AuthUser>(
    pool,
    'select id, name, email, role, org_id from users where lower(email) = lower($1)',
    [email.trim()],
  );
  if (!user || passcode !== DEMO_PASSCODE) throw fail('invalid_credentials');
  const token = randomBytes(32).toString('base64url');
  await pool.query('insert into sessions (token, user_id) values ($1, $2)', [token, user.id]);
  return { user, token };
}

export async function signOut(token: string | null): Promise<void> {
  if (token) await pool.query('delete from sessions where token = $1', [token]);
}

export function sessionToken(req: Request): string | null {
  return readCookie(req, SESSION_COOKIE);
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/' });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/' });
}

export async function attachUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = sessionToken(req);
  if (token) {
    const user = await queryOne<AuthUser>(
      pool,
      `select u.id, u.name, u.email, u.role, u.org_id
       from sessions s join users u on u.id = s.user_id
       where s.token = $1`,
      [token],
    );
    if (user) req.authUser = user;
  }
  next();
}
