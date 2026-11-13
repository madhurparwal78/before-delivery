import { config } from '../config';
import { db, transaction } from '../db/pool';
import { decoyHash, hashPassword, verifyPassword } from '../domain/passwords';
import { COPY, emailValue, FieldErrors, textBetween } from '../domain/validate';
import { ApiError } from '../errors';
import { Context, SESSION_DAYS, type Role, type SessionUser } from '../http/context';
import { clearSessionCookie, sendJson, sendNoContent, setSessionCookie } from '../http/respond';
import { token, uuid } from '../ids';
import { letters, queueLetter } from '../services/mail';
import type { Router } from '../http/router';
import { HANDLED } from '../http/router';

interface AccountRow {
  id: string;
  display_name: string;
  email: string;
  password_hash: string;
  role: Role;
  company_id: string | null;
  unlocked: boolean;
}

function signInBody(user: { id: string; display_name: string; role: Role; unlocked: boolean }): unknown {
  return { user: { id: user.id, display_name: user.display_name, role: user.role, unlocked: user.unlocked } };
}

async function startSession(userId: string, now: Date): Promise<string> {
  const value = token();
  await db.query('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)', [
    value,
    userId,
    now,
    new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000),
  ]);
  return value;
}

async function findAccount(email: string): Promise<AccountRow | null> {
  return db.one<AccountRow>(
    'SELECT id, display_name, email, password_hash, role, company_id, unlocked FROM users WHERE email_lower = $1',
    [email.toLowerCase()],
  );
}

export function registerAuthRoutes(router: Router): void {
  router.post('/api/auth/sign-in', async (ctx: Context) => {
    const body = ctx.json();
    const email = typeof body['email'] === 'string' ? body['email'] : '';
    const password = typeof body['password'] === 'string' ? body['password'] : '';
    const account = await findAccount(email);
    /** The same hashing work runs whether or not the address has an account. */
    const matches = await verifyPassword(password, account?.password_hash ?? (await decoyHash()));
    if (!account || !matches) throw new ApiError('invalid_credentials');
    setSessionCookie(ctx.res, await startSession(account.id, await ctx.now()));
    return signInBody(account);
  });

  router.post('/api/auth/sign-out', async (ctx: Context) => {
    const cookie = ctx.header('cookie');
    const match = /cb_session=([^;]+)/.exec(cookie ?? '');
    if (match?.[1]) await db.query('DELETE FROM sessions WHERE token = $1', [match[1]]);
    clearSessionCookie(ctx.res);
    sendNoContent(ctx.res);
    return HANDLED;
  });

  router.get('/api/me', async (ctx: Context) => {
    const user: SessionUser = ctx.requireUser();
    return {
      id: user.id,
      display_name: user.display_name,
      email: user.email,
      role: user.role,
      company_slug: user.company_slug,
      unlocked: user.unlocked,
    };
  });

  router.post('/api/auth/join', async (ctx: Context) => {
    const body = ctx.json();
    const errors = new FieldErrors();
    const displayName = textBetween(body['display_name'], 2, 40);
    const email = emailValue(body['email']);
    const password = typeof body['password'] === 'string' && body['password'].length >= 10 ? body['password'] : null;
    if (!displayName) errors.add('display_name', COPY.display_name);
    if (!email) errors.add('email', COPY.email);
    if (!password) errors.add('password', COPY.password);
    errors.throwIfAny();

    const now = await ctx.now();
    /** The same hashing work runs for a new and an existing address. */
    const passwordHash = await hashPassword(password as string);
    const existing = await findAccount(email as string);
    await transaction(async (tx) => {
      if (existing) {
        await queueLetter(tx, now, letters.joinExisting(existing.email));
        return;
      }
      const value = token();
      await tx.query(
        `INSERT INTO email_tokens (token, kind, email, display_name, password_hash, created_at)
         VALUES ($1, 'join', $2, $3, $4, $5)`,
        [value, email, displayName, passwordHash, now],
      );
      await queueLetter(tx, now, letters.join(email as string, value));
    });
    sendJson(ctx.res, 202, { status: 'check_email' });
    return HANDLED;
  });

  router.post('/api/auth/join/confirm', async (ctx: Context) => {
    const body = ctx.json();
    const value = typeof body['token'] === 'string' ? body['token'] : '';
    const now = await ctx.now();
    const created = await transaction(async (tx) => {
      const row = await tx.one<{ email: string; display_name: string; password_hash: string }>(
        `UPDATE email_tokens SET used_at = $2
           WHERE token = $1 AND kind = 'join' AND used_at IS NULL AND created_at > $3
         RETURNING email, display_name, password_hash`,
        [value, now, new Date(now.getTime() - config.emailLinkTtlSeconds * 1000)],
      );
      if (!row) throw new ApiError('token_invalid');
      const id = uuid();
      await tx.query(
        `INSERT INTO users (id, display_name, email, email_lower, password_hash, role, unlocked, created_at)
         VALUES ($1, $2, $3, $4, $5, 'member', false, $6)`,
        [id, row.display_name, row.email, row.email.toLowerCase(), row.password_hash, now],
      );
      return { id, display_name: row.display_name, role: 'member' as Role, unlocked: false };
    });
    setSessionCookie(ctx.res, await startSession(created.id, now));
    sendJson(ctx.res, 201, signInBody(created));
    return HANDLED;
  });

  router.post('/api/auth/forgot', async (ctx: Context) => {
    const body = ctx.json();
    const errors = new FieldErrors();
    const email = emailValue(body['email']);
    if (!email) errors.add('email', COPY.email);
    errors.throwIfAny();

    const now = await ctx.now();
    const account = await findAccount(email as string);
    /** The same hashing work runs whether or not the address has an account. */
    await hashPassword(email as string);
    if (account) {
      await transaction(async (tx) => {
        const value = token();
        await tx.query(
          `INSERT INTO email_tokens (token, kind, user_id, email, created_at) VALUES ($1, 'reset', $2, $3, $4)`,
          [value, account.id, account.email, now],
        );
        await queueLetter(tx, now, letters.reset(account.email, value));
      });
    }
    sendJson(ctx.res, 202, { status: 'sent' });
    return HANDLED;
  });

  router.post('/api/auth/reset', async (ctx: Context) => {
    const body = ctx.json();
    const value = typeof body['token'] === 'string' ? body['token'] : '';
    const password = typeof body['password'] === 'string' && body['password'].length >= 10 ? body['password'] : null;
    if (!password) throw new ApiError('validation_failed', { fields: { password: COPY.password } });

    const now = await ctx.now();
    const passwordHash = await hashPassword(password);
    const account = await transaction(async (tx) => {
      const row = await tx.one<{ user_id: string }>(
        `UPDATE email_tokens SET used_at = $2
           WHERE token = $1 AND kind IN ('reset', 'set_password') AND used_at IS NULL AND created_at > $3
         RETURNING user_id`,
        [value, now, new Date(now.getTime() - config.emailLinkTtlSeconds * 1000)],
      );
      if (!row?.user_id) throw new ApiError('token_invalid');
      await tx.query('UPDATE users SET password_hash = $2 WHERE id = $1', [row.user_id, passwordHash]);
      await tx.query('DELETE FROM sessions WHERE user_id = $1', [row.user_id]);
      return tx.one<{ id: string; display_name: string; role: Role; unlocked: boolean }>(
        'SELECT id, display_name, role, unlocked FROM users WHERE id = $1',
        [row.user_id],
      );
    });
    if (!account) throw new ApiError('token_invalid');
    setSessionCookie(ctx.res, await startSession(account.id, now));
    return signInBody(account);
  });
}
