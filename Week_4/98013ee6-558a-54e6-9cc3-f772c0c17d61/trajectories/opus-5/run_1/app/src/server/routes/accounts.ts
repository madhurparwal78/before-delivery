import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { one, pool, query } from '../db.js';
import { now } from '../clock.js';
import { conflict, invalidCredentials, validation } from '../errors.js';
import {
  clearSessionCookie,
  cookies,
  requireViewer,
  route,
  sendJson,
  setSessionCookie,
} from '../http.js';
import { mails, sendMail } from '../mail.js';
import {
  readString,
  requireEmail,
  requireHandle,
  requireName,
  requirePassword,
} from '../domain/validate.js';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, derived] = stored.split(':');
  if (scheme !== 'scrypt' || !salt || !derived) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(derived, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export async function startSession(userId: number): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await pool.query('insert into sessions (token, user_id, created_at) values ($1, $2, $3)', [
    token,
    userId,
    now().toISOString(),
  ]);
  return token;
}

route(
  'POST',
  '/api/accounts',
  async (ctx) => {
    const rawHandle = readString(ctx.body, 'handle');
    if (rawHandle !== null) {
      const taken = await one('select id from users where handle = $1', [rawHandle.trim()]);
      if (taken) throw conflict('handle_taken');
    }
    const email = requireEmail(readString(ctx.body, 'email'));
    const password = requirePassword(readString(ctx.body, 'password'));
    const name = requireName(readString(ctx.body, 'name'));
    const handle = requireHandle(rawHandle);
    const emailLower = email.toLowerCase();
    const existing = await one('select id from users where email_lower = $1', [emailLower]);
    if (existing) {
      sendMail(mails.existingAccount(email));
    } else {
      const code = String(randomInt(0, 1000000)).padStart(6, '0');
      await pool.query(
        `insert into signup_codes (email_lower, email, name, handle, password_hash, code, created_at)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (email_lower) do update set email = excluded.email, name = excluded.name,
           handle = excluded.handle, password_hash = excluded.password_hash,
           code = excluded.code, created_at = excluded.created_at`,
        [emailLower, email, name, handle, hashPassword(password), code, now().toISOString()],
      );
      sendMail(mails.signupCode(email, code));
    }
    sendJson(ctx.res, 202, { status: 'code_sent' });
  },
  { auth: false },
);

route(
  'POST',
  '/api/accounts/confirm',
  async (ctx) => {
    const email = (readString(ctx.body, 'email') ?? '').trim().toLowerCase();
    const code = (readString(ctx.body, 'code') ?? '').trim();
    const pending = await one<{
      email: string;
      name: string;
      handle: string;
      password_hash: string;
      code: string;
    }>('select email, name, handle, password_hash, code from signup_codes where email_lower = $1', [
      email,
    ]);
    if (!pending || pending.code !== code) throw validation('code');
    const taken = await one('select id from users where handle = $1', [pending.handle]);
    if (taken) throw conflict('handle_taken');
    const created = await one<{ id: number; name: string; handle: string }>(
      `insert into users (email, email_lower, password_hash, name, handle, created_at)
       values ($1, $2, $3, $4, $5, $6) returning id, name, handle`,
      [pending.email, email, pending.password_hash, pending.name, pending.handle, now().toISOString()],
    );
    if (!created) throw validation('code');
    await pool.query('delete from signup_codes where email_lower = $1', [email]);
    const token = await startSession(created.id);
    setSessionCookie(ctx.res, token);
    sendJson(ctx.res, 200, {
      user: { id: created.id, name: created.name, handle: created.handle },
    });
  },
  { auth: false },
);

route(
  'POST',
  '/api/session',
  async (ctx) => {
    const email = (readString(ctx.body, 'email') ?? '').trim().toLowerCase();
    const password = readString(ctx.body, 'password') ?? '';
    const user = await one<{
      id: number;
      name: string;
      handle: string;
      email: string;
      password_hash: string;
    }>('select id, name, handle, email, password_hash from users where email_lower = $1', [email]);
    if (!user || !verifyPassword(password, user.password_hash)) throw invalidCredentials();
    const token = await startSession(user.id);
    setSessionCookie(ctx.res, token);
    sendJson(ctx.res, 200, {
      user: { id: user.id, name: user.name, handle: user.handle, email: user.email },
    });
  },
  { auth: false },
);

route(
  'DELETE',
  '/api/session',
  async (ctx) => {
    const token = cookies(ctx.req).ml_session;
    if (token) await query('delete from sessions where token = $1', [token]);
    clearSessionCookie(ctx.res);
    ctx.res.writeHead(204).end();
  },
  { auth: false },
);

route('GET', '/api/me', async (ctx) => {
  const viewer = requireViewer(ctx);
  sendJson(ctx.res, 200, {
    user: { id: viewer.id, name: viewer.name, handle: viewer.handle, email: viewer.email },
  });
});
