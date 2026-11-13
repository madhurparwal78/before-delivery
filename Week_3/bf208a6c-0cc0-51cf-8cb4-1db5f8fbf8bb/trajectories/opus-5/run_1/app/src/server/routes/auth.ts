import { randomInt, randomUUID } from 'node:crypto';
import { AUTH_COPY } from '../../shared/copy';
import {
  accountPasswordError,
  clean,
  displayNameError,
  emailError,
  normaliseEmail,
} from '../../shared/validate';
import { pool } from '../db';
import { env } from '../env';
import { invalid, serviceUnavailable, signInRequired, unconfirmed, wrongCredentials } from '../errors';
import type { Ctx, Router } from '../http';
import { sendMail, signupMail } from '../mail';
import { markService } from '../services';
import { SESSION_COOKIE, hashPassword, makeSessionValue, verifyPassword } from '../session';

interface UserRow {
  id: string;
  display_name: string;
  email: string;
  password_hash: string;
  verified: boolean;
  verify_code: string | null;
  verify_expires_at: Date | null;
}

const loadUserByEmail = async (email: string): Promise<UserRow | null> => {
  const result = await pool.query<UserRow>(
    'select id, display_name, email, password_hash, verified, verify_code, verify_expires_at from users where email = $1',
    [email],
  );
  return result.rows[0] ?? null;
};

const signupHandler = async (ctx: Ctx): Promise<void> => {
  const body = await ctx.json<{ display_name?: string; email?: string; password?: string }>();
  const displayName = clean(body.display_name ?? '');
  const email = normaliseEmail(body.email ?? '');
  const password = body.password ?? '';

  const errors: Record<string, string> = {};
  const nameError = displayNameError(displayName);
  if (nameError !== null) errors.display_name = nameError;
  const mailError = emailError(email);
  if (mailError !== null) errors.email = mailError;
  const passwordError = accountPasswordError(password);
  if (passwordError !== null) errors.password = passwordError;
  if (Object.keys(errors).length > 0) throw invalid(errors);

  const existing = await loadUserByEmail(email);
  if (existing !== null && existing.verified) throw invalid({ email: AUTH_COPY.emailTaken });

  const code = String(randomInt(0, 1000000)).padStart(6, '0');
  try {
    await sendMail(signupMail(email, code));
    markService('mail', true);
  } catch {
    markService('mail', false);
    throw serviceUnavailable('mail');
  }

  const expiresAt = new Date(Date.now() + env.verifyCodeTtlSeconds * 1000);
  if (existing === null) {
    await pool.query(
      `insert into users (id, display_name, email, password_hash, verified, verify_code, verify_expires_at)
       values ($1, $2, $3, $4, false, $5, $6)`,
      [randomUUID(), displayName, email, hashPassword(password), code, expiresAt],
    );
  } else {
    await pool.query(
      'update users set display_name = $1, password_hash = $2, verify_code = $3, verify_expires_at = $4 where id = $5',
      [displayName, hashPassword(password), code, expiresAt, existing.id],
    );
  }
  ctx.sendJson(202, { status: 'code_sent' });
};

const verifyHandler = async (ctx: Ctx): Promise<void> => {
  const body = await ctx.json<{ email?: string; code?: string }>();
  const email = normaliseEmail(body.email ?? '');
  const code = clean(body.code ?? '');
  const user = await loadUserByEmail(email);
  if (
    user === null ||
    user.verified ||
    user.verify_code === null ||
    user.verify_code !== code ||
    user.verify_expires_at === null ||
    user.verify_expires_at.getTime() < Date.now()
  ) {
    throw invalid({ code: AUTH_COPY.badCode });
  }
  await pool.query('update users set verified = true, verify_code = null, verify_expires_at = null where id = $1', [
    user.id,
  ]);
  ctx.setCookie(SESSION_COOKIE, makeSessionValue(user.id), null);
  ctx.sendJson(200, { user: { id: user.id, display_name: user.display_name, email: user.email } });
};

const signinHandler = async (ctx: Ctx): Promise<void> => {
  const body = await ctx.json<{ email?: string; password?: string }>();
  const email = normaliseEmail(body.email ?? '');
  const user = await loadUserByEmail(email);
  if (user === null || !verifyPassword(body.password ?? '', user.password_hash)) throw wrongCredentials();
  if (!user.verified) throw unconfirmed();
  ctx.setCookie(SESSION_COOKIE, makeSessionValue(user.id), null);
  ctx.sendJson(200, { user: { id: user.id, display_name: user.display_name, email: user.email } });
};

export const loadUser = async (userId: string): Promise<{ id: string; display_name: string; email: string } | null> => {
  const result = await pool.query<{ id: string; display_name: string; email: string }>(
    'select id, display_name, email from users where id = $1',
    [userId],
  );
  return result.rows[0] ?? null;
};

export const registerAuthRoutes = (router: Router): void => {
  router.add('POST', '/api/auth/signup', signupHandler);
  router.add('POST', '/api/auth/verify', verifyHandler);
  router.add('POST', '/api/auth/signin', signinHandler);
  router.add('POST', '/api/auth/signout', (ctx) => {
    ctx.clearCookie(SESSION_COOKIE);
    ctx.sendEmpty(204);
  });
  router.add('GET', '/api/me', async (ctx) => {
    if (ctx.userId === null) throw signInRequired();
    const user = await loadUser(ctx.userId);
    if (user === null) throw signInRequired();
    ctx.sendJson(200, { user });
  });
};
