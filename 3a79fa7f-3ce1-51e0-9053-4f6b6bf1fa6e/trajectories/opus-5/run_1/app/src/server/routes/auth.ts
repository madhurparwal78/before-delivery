import { isoSeconds, now } from '../clock.js';
import { query, queryOne, withTransaction } from '../db.js';
import { fail, failValidation } from '../errors.js';
import { reply, type Ctx, type Router } from '../http.js';
import {
  accountCartId,
  endOtherSessions,
  endSession,
  guestCartId,
  randomToken,
  requireSession,
  startSession,
} from '../auth.js';
import { mergeGuestCart } from '../domain/cartmerge.js';
import { hashPassword, verifyPassword } from '../domain/passwords.js';
import { EMAIL_MESSAGE, isValidEmail, normaliseEmail } from '../domain/validate.js';
import { queueNotice } from '../services/notices.js';
import { config } from '../config.js';

const PASSWORD_MESSAGE = 'Use 10 or more characters with a letter and a digit.';
const RESET_LIFETIME_SECONDS = 1800;
export const RESET_REQUEST_MESSAGE = 'If an account exists for that email, a reset link is on its way.';

function isStrongPassword(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 10 &&
    value.length <= 72 &&
    /[A-Za-z]/.test(value) &&
    /[0-9]/.test(value)
  );
}

interface UserRow {
  id: string;
  email: string;
  role: string;
  password_hash: string;
}

export function userShape(row: { id: string | number; email: string; role: string }): Record<string, unknown> {
  return { id: Number(row.id), email: row.email, role: row.role };
}

export async function demoCreditShape(userId: number): Promise<Record<string, unknown> | null> {
  const row = await queryOne<{ amount_cents: number; expires_at: Date; used: boolean }>(
    'SELECT amount_cents, expires_at, used FROM demo_credits WHERE user_id = $1',
    [userId],
  );
  if (!row) return null;
  return { amount_cents: row.amount_cents, expires_at: isoSeconds(row.expires_at), used: row.used };
}

async function mergeAfterSignIn(ctx: Ctx, userId: number): Promise<void> {
  const guestId = await guestCartId(ctx);
  if (guestId === null) return;
  const accountId = await accountCartId(userId);
  await withTransaction((client) => mergeGuestCart(client, guestId, accountId, now()));
}

export function registerAuthRoutes(router: Router): void {
  router.add('POST', '/api/auth/signup', 'anyone', async (ctx) => {
    const fields: Record<string, string> = {};
    if (!isValidEmail(ctx.body.email)) fields.email = EMAIL_MESSAGE;
    if (!isStrongPassword(ctx.body.password)) fields.password = PASSWORD_MESSAGE;
    if (Object.keys(fields).length > 0) failValidation(fields);

    const email = normaliseEmail(ctx.body.email as string);
    const created = await queryOne<UserRow>(
      `INSERT INTO users (email, password_hash, role, created_at) VALUES ($1, $2, 'customer', $3)
       ON CONFLICT (email) DO NOTHING RETURNING id, email, role, password_hash`,
      [email, hashPassword(ctx.body.password as string), now()],
    );
    if (!created) fail('email_taken', { fields: { email: 'An account with this email already exists.' } });

    await startSession(ctx, Number(created.id));
    await mergeAfterSignIn(ctx, Number(created.id));
    return reply(201, { user: userShape(created) });
  });

  router.add('POST', '/api/auth/login', 'anyone', async (ctx) => {
    const email = typeof ctx.body.email === 'string' ? normaliseEmail(ctx.body.email) : '';
    const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
    const user = await queryOne<UserRow>('SELECT id, email, role, password_hash FROM users WHERE email = $1', [email]);
    if (!user || !verifyPassword(password, user.password_hash)) fail('invalid_credentials');

    await startSession(ctx, Number(user.id));
    if (user.role === 'customer') await mergeAfterSignIn(ctx, Number(user.id));
    return { user: userShape(user) };
  });

  router.add('POST', '/api/auth/logout', 'signed-in', async (ctx) => {
    const session = requireSession(ctx);
    await endSession(ctx, session.sessionId);
    return {};
  });

  router.add('POST', '/api/auth/password-reset', 'anyone', async (ctx) => {
    const email = typeof ctx.body.email === 'string' ? normaliseEmail(ctx.body.email) : '';
    const user = email ? await queryOne<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]) : undefined;
    if (user) {
      const token = randomToken(32);
      const at = now();
      await withTransaction(async (client) => {
        await client.query('UPDATE reset_tokens SET used = true WHERE user_id = $1 AND used = false', [user.id]);
        await client.query(
          'INSERT INTO reset_tokens (token, user_id, expires_at, created_at) VALUES ($1,$2,$3,$4)',
          [token, user.id, new Date(at.getTime() + RESET_LIFETIME_SECONDS * 1000), at],
        );
        await queueNotice(
          client,
          {
            to: email,
            template: 'password_reset',
            reference: null,
            subject: 'Reset your Tern Foils password',
            body: `Reset your Tern Foils password with this link:\n${config.appPublicUrl}/reset-password?token=${token}\nThe link expires in 30 minutes.`,
          },
          at,
        );
      });
    }
    return reply(202, { message: RESET_REQUEST_MESSAGE });
  });

  router.add('POST', '/api/auth/password-reset/confirm', 'anyone', async (ctx) => {
    if (!isStrongPassword(ctx.body.password)) failValidation({ password: PASSWORD_MESSAGE });
    const token = typeof ctx.body.token === 'string' ? ctx.body.token : '';
    const row = await queryOne<{ token: string; user_id: string }>(
      'SELECT token, user_id FROM reset_tokens WHERE token = $1 AND used = false AND expires_at > $2',
      [token, now()],
    );
    if (!row) fail('invalid_token', { fields: { token: 'This reset link is invalid or has expired.' } });

    await query('UPDATE reset_tokens SET used = true WHERE token = $1', [row.token]);
    await query('UPDATE users SET password_hash = $2 WHERE id = $1', [row.user_id, hashPassword(ctx.body.password as string)]);
    await endOtherSessions(Number(row.user_id), null);
    ctx.clearCookie('tf_session');
    return { message: 'Your password has been reset.' };
  });

  router.add('POST', '/api/auth/password', 'signed-in', async (ctx) => {
    const session = requireSession(ctx);
    const stored = await queryOne<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [
      session.userId,
    ]);
    const current = typeof ctx.body.current_password === 'string' ? ctx.body.current_password : '';
    const fields: Record<string, string> = {};
    if (!stored || !verifyPassword(current, stored.password_hash)) {
      fields.current_password = 'Your current password is incorrect.';
    }
    if (!isStrongPassword(ctx.body.new_password)) fields.new_password = PASSWORD_MESSAGE;
    if (Object.keys(fields).length > 0) failValidation(fields);

    await query('UPDATE users SET password_hash = $2 WHERE id = $1', [
      session.userId,
      hashPassword(ctx.body.new_password as string),
    ]);
    await endOtherSessions(session.userId, session.sessionId);
    return {};
  });

  router.add('GET', '/api/me', 'signed-in', async (ctx) => {
    const session = requireSession(ctx);
    return {
      user: { id: session.userId, email: session.email, role: session.role },
      demo_credit: session.role === 'customer' ? await demoCreditShape(session.userId) : null,
    };
  });
}
