import type pg from 'pg';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DeferredResponse } from './api.js';
import { apiError, sendJson, readJsonBody } from './http.js';
import {
  checkSignInLimit, createSession, sessionCookieHeader, landingAddress, recordSignInFailure,
  resetSignInCount, userProjection,
} from './auth.js';
import { inTx } from './db.js';
import type { User } from './auth.js';

export async function handleSignIn(req: IncomingMessage, res: DeferredResponse): Promise<void> {
  const body = await readJsonBody(req, 64000) as Record<string, unknown>;
  const email = typeof body.email === 'string' ? body.email : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const next = typeof body.next === 'string' ? body.next : undefined;
  if (!email.trim() || !password) {
    sendJson(res, 401, { error: 'invalid_credentials', message: 'Email or password is incorrect.' });
    return;
  }
  const result = await inTx(async (c): Promise<
    { ok: true; user: User; home: string; cookie: string } |
    { ok: false; status: number; body: Record<string, unknown>; headers?: Record<string, string> }
  > => {
    await checkSignInLimit(c, email);
    const u = await c.query(`SELECT * FROM users WHERE lower(email) = lower($1)`, [email.trim()]);
    const user = u.rows[0];
    const passwordOk = !!user && user.password_hash === `seed:${password}`;
    if (!user || !passwordOk) {
      const lock = await recordSignInFailure(c, email);
      if (lock) return { ok: false, status: lock.status, body: lock.body as Record<string, unknown>, headers: lock.headers };
      return { ok: false, status: 401, body: { error: 'invalid_credentials', message: 'Email or password is incorrect.' } };
    }
    await resetSignInCount(c, email);
    const home = await landingAddress(c, user as unknown as User, next);
    const sess = await createSession(c, user.id);
    return { ok: true, user: user as unknown as User, home, cookie: sessionCookieHeader(sess.token, sess.expiresAt) };
  });
  if (!result.ok) {
    sendJson(res, result.status, result.body, result.headers ?? {});
    return;
  }
  sendJson(res, 200, { user: userProjection(result.user), home: result.home }, { 'Set-Cookie': result.cookie });
}

export function parseCookieToken(req: IncomingMessage): string | null {
  const raw = req.headers['cookie'];
  if (typeof raw !== 'string') return null;
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === 'swathdeck_session') return rest.join('=');
  }
  return null;
}

export async function requireSessionRow(c: pg.PoolClient, req: IncomingMessage) {
  const { currentSession } = await import('./auth.js');
  const s = await currentSession(c, req);
  if (!s) throw apiError(401, 'unauthenticated', 'Sign in to continue');
  return s;
}


