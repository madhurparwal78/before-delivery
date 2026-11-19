/* Account and authentication endpoints. */
import crypto from 'node:crypto';
import argon2 from 'argon2';
import { ApiError } from '../errors.js';
import type { Route, RouteHandler } from '../routes.js';
import { route } from '../routes.js';
import { cookieHeader, type Ctx } from '../context.js';
import type { Services } from '../routes.js';
import { isEmail, isUsername, newToken, totpNow } from '../util.js';

type LoginRow = {
  id: string;
  username: string;
  email: string;
  email_verified: boolean;
  totp_secret: string | null;
  totp_enabled: boolean;
  role: string;
  suspended: boolean;
  created_at: Date;
};

export function registerAuthRoutes(services: Services, add: (r: Route) => void): void {
  add(route('POST', '/api/auth/signup', signup(services)));
  add(route('POST', '/api/auth/verify', verify(services)));
  add(route('POST', '/api/auth/verify/resend', resend(services)));
  add(route('POST', '/api/auth/login', login(services)));
  add(route('POST', '/api/auth/logout', logout(services)));
  add(route('POST', '/api/auth/password-reset', passwordReset(services)));
  add(route('POST', '/api/auth/password-reset/confirm', passwordResetConfirm(services)));
  add(route('GET', '/api/me', me(services)));
  add(route('POST', '/api/me/totp/setup', totpSetup(services)));
  add(route('POST', '/api/me/totp/enable', totpEnable(services)));
}

function body(ctx: Ctx): Record<string, unknown> {
  return (ctx.body ?? {}) as Record<string, unknown>;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function signup(services: Services): RouteHandler {
  return async (ctx) => {
    const b = body(ctx);
    const email = str(b.email).trim();
    const username = str(b.username).trim();
    const password = str(b.password);
    const fields: Record<string, string> = {};
    if (!isEmail(email)) fields.email = 'Enter a valid email address';
    if (!isUsername(username)) fields.username = 'Usernames are 3 to 20 letters, digits, underscores or hyphens';
    if (password.length < 10 || password.length > 128) fields.password = 'Passwords are 10 to 128 characters';
    if (Object.keys(fields).length > 0) throw new ApiError('VALIDATION', 'Check the fields', { fields });

    const emailLc = email.toLowerCase();
    const usernameLc = username.toLowerCase();
    const taken: Record<string, string> = {};
    const usernameExists = await services.db.query(`SELECT 1 FROM accounts WHERE username_lc = $1`, [usernameLc]);
    if (usernameExists.rows.length > 0) taken.username = 'That username is taken';
    const emailExists = await services.db.query(`SELECT 1 FROM accounts WHERE email_lc = $1`, [emailLc]);
    if (emailExists.rows.length > 0) taken.email = 'That email is already registered';
    if (Object.keys(taken).length > 0) throw new ApiError('NAME_TAKEN', 'Already registered', { fields: taken });

    const hash = await argon2.hash(password, { type: argon2.argon2id });
    const inserted = await services.db.query(
      `INSERT INTO accounts (username, username_lc, email, email_lc, password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at`,
      [username, usernameLc, email, emailLc, hash]
    );
    const row = inserted.rows[0] as { id: string; created_at: Date };
    const id = Number(row.id);
    await createSession(services, ctx, id);
    const token = await issueVerification(services, id);
    services.mailer.verification(email, token);
    await services.db.query(`INSERT INTO verification_mails (account_id) VALUES ($1)`, [id]);
    ctx.account = {
      id,
      username,
      email,
      emailVerified: false,
      totpEnabled: false,
      role: 'user',
      suspended: false,
      createdAt: new Date(row.created_at),
    };
    return { status: 201, body: ownAccountView(ctx.account) };
  };
}

export async function createSession(services: Services, ctx: Ctx, accountId: number): Promise<void> {
  const token = newToken(32);
  await services.db.query(`INSERT INTO sessions (token, account_id) VALUES ($1,$2)`, [token, accountId]);
  ctx.setCookie(cookieHeader('mh_session', token));
  ctx.sessionToken = token;
}

async function issueVerification(services: Services, accountId: number): Promise<string> {
  const token = newToken(24);
  await services.db.query(
    `INSERT INTO verification_tokens (account_id, token, expires_at) VALUES ($1,$2, now() + make_interval(secs => $3))`,
    [accountId, token, services.cfg.limits.verifyTtl]
  );
  return token;
}

function verify(services: Services): RouteHandler {
  return async (ctx) => {
    const token = str(body(ctx).token);
    const bad = new ApiError('VALIDATION', 'This link has expired or was already used', {
      fields: { token: 'This link has expired or was already used' },
    });
    if (token === '') throw bad;
    const rows = await services.db.query(
      `SELECT id, account_id, expires_at, used_at FROM verification_tokens WHERE token = $1`,
      [token]
    );
    if (rows.rows.length === 0) throw bad;
    const row = rows.rows[0] as { id: string; account_id: string; expires_at: Date; used_at: Date | null };
    if (row.used_at !== null || row.expires_at.getTime() <= Date.now()) throw bad;
    await services.db.query(`UPDATE verification_tokens SET used_at = now() WHERE id = $1`, [Number(row.id)]);
    await services.db.query(`UPDATE accounts SET email_verified = true WHERE id = $1`, [Number(row.account_id)]);
    return { status: 200, body: { emailVerified: true } };
  };
}

function resend(services: Services): RouteHandler {
  return async (ctx) => {
    requireAccount(ctx);
    const account = ctx.account as NonNullable<Ctx['account']>;
    if (account.emailVerified) throw new ApiError('CONFLICT', 'Already verified');
    const windowSeconds = services.cfg.limits.verifyResendWindow;
    const countRows = await services.db.query(
      `SELECT count(*)::int AS n FROM verification_mails WHERE account_id = $1 AND sent_at > now() - make_interval(secs => $2)`,
      [account.id, windowSeconds]
    );
    const sent = (countRows.rows[0] as { n: number }).n;
    if (sent >= services.cfg.limits.verifyResendLimit) {
      throw new ApiError('RATE_LIMITED', 'Too many emails sent — try again later');
    }
    await services.db.query(`UPDATE verification_tokens SET used_at = now() WHERE account_id = $1 AND used_at IS NULL`, [account.id]);
    const token = await issueVerification(services, account.id);
    services.mailer.verification(account.email, token);
    await services.db.query(`INSERT INTO verification_mails (account_id) VALUES ($1)`, [account.id]);
    return { status: 202, body: { sent: true } };
  };
}

function requireAccount(ctx: Ctx): void {
  if (ctx.account === null) throw new ApiError('UNAUTHENTICATED', 'Sign in to continue');
}

function login(services: Services): RouteHandler {
  return async (ctx) => {
    const b = body(ctx);
    const login = str(b.login).trim();
    const password = str(b.password);
    const totp = str(b.totp);
    const rows = await services.db.query(
      `SELECT id, username, email, email_verified, totp_secret, totp_enabled, role, suspended, password_hash, failed_count, locked_until, created_at
       FROM accounts WHERE email_lc = $1 OR username_lc = $1`,
      [login.toLowerCase()]
    );
    if (rows.rows.length === 0) throw new ApiError('UNAUTHENTICATED', 'Email or password is incorrect');
    const a = rows.rows[0] as LoginRow & { password_hash: string; failed_count: number; locked_until: Date | null };
    if (a.suspended) throw new ApiError('SUSPENDED', 'This account is suspended');
    const cfg = services.cfg.limits;
    const now = Date.now();
    if (a.locked_until !== null && a.locked_until.getTime() > now) {
      throw new ApiError('RATE_LIMITED', 'Too many failed sign-ins. Try again later or reset your password.', {
        retryAfter: Math.max(1, Math.ceil((a.locked_until.getTime() - now) / 1000)),
      });
    }
    const ok = await argon2.verify(a.password_hash, password).catch(() => false);
    if (!ok) return loginFailed(services, a, cfg.loginLockoutAttempts, cfg.loginLockoutSeconds, 'Email or password is incorrect');
    if (a.totp_enabled) {
      if (totp === '') throw new ApiError('TOTP_REQUIRED', 'Enter the 6-digit code from your authenticator app');
      if (!/^\d{6}$/.test(totp)) {
        throw new ApiError('VALIDATION', 'Enter the 6-digit code from your authenticator app', {
          fields: { totp: 'Enter the 6-digit code from your authenticator app' },
        });
      }
      const codes = totpWindow(a.totp_secret ?? '');
      if (!codes.includes(totp)) {
        return loginFailed(services, a, cfg.loginLockoutAttempts, cfg.loginLockoutSeconds, "That code didn't match", {
          totp: "That code didn't match",
        });
      }
    }
    await services.db.query(`UPDATE accounts SET failed_count = 0, locked_until = NULL WHERE id = $1`, [Number(a.id)]);
    await createSession(services, ctx, Number(a.id));
    ctx.account = {
      id: Number(a.id),
      username: a.username,
      email: a.email,
      emailVerified: a.email_verified,
      totpEnabled: a.totp_enabled,
      role: a.role === 'admin' ? 'admin' : 'user',
      suspended: a.suspended,
      createdAt: new Date(a.created_at),
    };
    return { status: 200, body: ownAccountView(ctx.account as NonNullable<Ctx["account"]>) };
  };
}

function totpWindow(secret: string): string[] {
  return [totpNow(secret, -30), totpNow(secret, 0), totpNow(secret, 30)];
}

async function loginFailed(
  services: Services,
  a: LoginRow & { failed_count: number },
  attempts: number,
  lockSeconds: number,
  message: string,
  fields?: Record<string, string>
): Promise<never> {
  const failed = a.failed_count + 1;
  if (failed >= attempts) {
    await services.db.query(
      `UPDATE accounts SET failed_count = $2, locked_until = now() + make_interval(secs => $3) WHERE id = $1`,
      [Number(a.id), failed, lockSeconds]
    );
    services.mailer.lockout(a.email);
    throw new ApiError('RATE_LIMITED', 'Too many failed sign-ins. Try again later or reset your password.');
  }
  await services.db.query(`UPDATE accounts SET failed_count = $2 WHERE id = $1`, [Number(a.id), failed]);
  throw new ApiError('UNAUTHENTICATED', message, fields);
}

function logout(services: Services): RouteHandler {
  return async (ctx) => {
    if (ctx.sessionToken !== null) {
      await services.db.query(`DELETE FROM sessions WHERE token = $1`, [ctx.sessionToken]);
    }
    ctx.setCookie(cookieHeader('mh_session', '', { maxAge: 0 }));
    ctx.account = null;
    return { status: 204, body: undefined };
  };
}

function passwordReset(services: Services): RouteHandler {
  return async (ctx) => {
    const email = str(body(ctx).email).trim();
    if (!isEmail(email)) {
      throw new ApiError('VALIDATION', 'Enter a valid email address', { fields: { email: 'Enter a valid email address' } });
    }
    const rows = await services.db.query(`SELECT id, email FROM accounts WHERE email_lc = $1`, [email.toLowerCase()]);
    if (rows.rows.length > 0) {
      const a = rows.rows[0] as { id: string; email: string };
      await services.db.query(`UPDATE password_reset_tokens SET used_at = now() WHERE account_id = $1 AND used_at IS NULL`, [Number(a.id)]);
      const token = newToken(24);
      await services.db.query(
        `INSERT INTO password_reset_tokens (account_id, token, expires_at) VALUES ($1,$2, now() + make_interval(secs => $3))`,
        [Number(a.id), token, services.cfg.limits.resetTtl]
      );
      services.mailer.passwordReset(a.email, token);
    }
    return { status: 202, body: { sent: true } };
  };
}

function passwordResetConfirm(services: Services): RouteHandler {
  return async (ctx) => {
    const b = body(ctx);
    const token = str(b.token);
    const newPassword = str(b.newPassword);
    const bad = new ApiError('VALIDATION', 'This link has expired or was already used', {
      fields: { token: 'This link has expired or was already used' },
    });
    if (token === '') throw bad;
    if (newPassword.length < 10 || newPassword.length > 128) {
      throw new ApiError('VALIDATION', 'Passwords are 10 to 128 characters', { fields: { newPassword: 'Passwords are 10 to 128 characters' } });
    }
    const rows = await services.db.query(
      `SELECT id, account_id, expires_at, used_at FROM password_reset_tokens WHERE token = $1`,
      [token]
    );
    if (rows.rows.length === 0) throw bad;
    const row = rows.rows[0] as { id: string; account_id: string; expires_at: Date; used_at: Date | null };
    if (row.used_at !== null || row.expires_at.getTime() <= Date.now()) throw bad;
    const hash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await services.db.query(`BEGIN`);
    try {
      await services.db.query(`UPDATE password_reset_tokens SET used_at = now() WHERE id = $1`, [Number(row.id)]);
      await services.db.query(
        `UPDATE accounts SET password_hash = $2, failed_count = 0, locked_until = NULL WHERE id = $1`,
        [Number(row.account_id), hash]
      );
      await services.db.query(`DELETE FROM sessions WHERE account_id = $1`, [Number(row.account_id)]);
      await services.db.query(`COMMIT`);
    } catch (err) {
      await services.db.query(`ROLLBACK`);
      throw err;
    }
    return { status: 200, body: { reset: true } };
  };
}

function me(services: Services): RouteHandler {
  return async (ctx) => {
    requireAccount(ctx);
    void services;
    return { status: 200, body: ownAccountView(ctx.account as NonNullable<Ctx["account"]>) };
  };
}

function totpSetup(services: Services): RouteHandler {
  return async (ctx) => {
    requireAccount(ctx);
    const account = ctx.account as NonNullable<Ctx['account']>;
    if (account.totpEnabled) throw new ApiError('CONFLICT', 'Two-factor authentication is already on');
    const secret = base32Secret();
    await services.db.query(`UPDATE accounts SET totp_secret = $2 WHERE id = $1`, [account.id, secret]);
    const otpauth = `otpauth://totp/Moothall:${encodeURIComponent(account.username)}?secret=${secret}&issuer=Moothall`;
    return { status: 200, body: { secret, otpauthUri: otpauth } };
  };
}

function totpEnable(services: Services): RouteHandler {
  return async (ctx) => {
    requireAccount(ctx);
    const account = ctx.account as NonNullable<Ctx['account']>;
    const code = str(body(ctx).code).trim();
    const rows = await services.db.query(`SELECT totp_secret FROM accounts WHERE id = $1`, [account.id]);
    const secret = (rows.rows[0] as { totp_secret: string | null }).totp_secret ?? '';
    const expected = totpWindow(secret);
    if (!/^\d{6}$/.test(code) || !expected.includes(code)) {
      throw new ApiError('VALIDATION', "That code didn't match", { fields: { code: "That code didn't match" } });
    }
    await services.db.query(`UPDATE accounts SET totp_enabled = true WHERE id = $1`, [account.id]);
    account.totpEnabled = true;
    return { status: 200, body: { totpEnabled: true } };
  };
}

function base32Secret(): string {
  const bytes = crypto.randomBytes(20);
  return base32Encode(bytes);
}

function base32Encode(buf: Buffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

export function ownAccountView(a: NonNullable<Ctx['account']>): {
  id: number;
  username: string;
  email: string;
  emailVerified: boolean;
  totpEnabled: boolean;
  role: 'user' | 'admin';
  createdAt: string;
} {
  return {
    id: a.id,
    username: a.username,
    email: a.email,
    emailVerified: a.emailVerified,
    totpEnabled: a.totpEnabled,
    role: a.role,
    createdAt: iso(a.createdAt),
  };
}

export function iso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
