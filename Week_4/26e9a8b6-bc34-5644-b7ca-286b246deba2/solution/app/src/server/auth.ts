import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { config, limits } from './config';
import { one, pool, transaction, type Db } from './db';
import { badCredentials, conflict, invalid, notSignedIn, tokenInvalid, unavailable } from './errors';
import { readCookie, SESSION_COOKIE, sessionCookie, type Ctx } from './http';
import { sendMail } from './mail';
import { enforceWindow, lockKey, lockWindow, recordEvent } from './rate-limit';
import { codePointLength } from '../shared/text';
import type { User } from '../shared/types';

const SESSION_SECONDS = 60 * 60 * 24 * 30;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const SCRYPT = { N: 16384, r: 8, p: 1 };

function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 32, SCRYPT, (error, key) => (error ? reject(error) : resolve(`${salt.toString('hex')}:${key.toString('hex')}`))),
  );
}

function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt, key] = stored.split(':');
  return new Promise((resolve, reject) =>
    scrypt(password, Buffer.from(salt ?? '', 'hex'), 32, SCRYPT, (error, derived) =>
      error ? reject(error) : resolve(timingSafeEqual(derived, Buffer.from(key ?? '', 'hex'))),
    ),
  );
}

interface UserRow { id: string; name: string; email: string; confirmed: boolean }
const toUser = (row: UserRow): User => ({ id: row.id, name: row.name, email: row.email, confirmed: row.confirmed });

export async function userFor(req: IncomingMessage): Promise<User | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const row = await one<UserRow>(
    pool,
    'SELECT u.id, u.name, u.email, u.confirmed FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1',
    [sha256(token)],
  );
  return row ? toUser(row) : null;
}

export async function createUser(db: Db, name: string, email: string, password: string, confirmed: boolean): Promise<User> {
  const id = randomUUID();
  const hash = await hashPassword(password);
  await db.query('INSERT INTO users (id, name, email, password_hash, confirmed) VALUES ($1, $2, $3, $4, $5)', [id, name, email, hash, confirmed]);
  return { id, name, email, confirmed };
}

async function startSession(db: Db, userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.query('INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)', [sha256(token), userId]);
  return token;
}

/**
 * Sends a fresh confirmation message; earlier tokens are voided only after the SMTP server accepted this one.
 * Sends for one person run one after another, so the link delivered last is always the one left alive.
 */
async function sendConfirmation(user: User): Promise<void> {
  const client = await pool.connect();
  const key = lockKey('confirm-send', user.id);
  let broken = false;
  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [key]);
    const token = randomBytes(32).toString('base64url');
    const hash = sha256(token);
    await client.query('INSERT INTO confirm_tokens (token_hash, user_id) VALUES ($1, $2)', [hash, user.id]);
    try {
      await sendMail(user.email, 'Confirm your Pennywasher account', `Confirm your Pennywasher account:\n\n${config.publicUrl}/confirm?token=${token}\n`);
    } catch {
      await client.query('DELETE FROM confirm_tokens WHERE token_hash = $1', [hash]);
      throw unavailable('mail_unavailable');
    }
    await client.query('UPDATE confirm_tokens SET closed = true WHERE user_id = $1 AND token_hash <> $2', [user.id, hash]);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1::bigint)', [key]).catch(() => { broken = true; });
    client.release(broken);
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function signUp(ctx: Ctx): Promise<unknown> {
  const body = await ctx.json();
  const { name, email, password } = body;
  if (typeof name !== 'string' || codePointLength(name) < 1 || codePointLength(name) > 80) throw invalid('name');
  if (typeof email !== 'string' || !EMAIL.test(email) || email.length > 254) throw invalid('email');
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) throw invalid('password');
  let user: User;
  let token: string;
  try {
    ({ user, token } = await transaction(async (db) => {
      const created = await createUser(db, name, email.toLowerCase(), password, false);
      return { user: created, token: await startSession(db, created.id) };
    }));
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw conflict('email_taken');
    throw error;
  }
  ctx.res.setHeader('Set-Cookie', sessionCookie(token, SESSION_SECONDS));
  await sendConfirmation(user);
  return { user, message_sent: true };
}

export async function signIn(ctx: Ctx): Promise<unknown> {
  const { email, password } = await ctx.json();
  if (typeof email !== 'string' || typeof password !== 'string') throw invalid('email');
  const address = email.toLowerCase();
  const subject = `${address}|${ctx.ip}`;
  const signedIn = await transaction(async (db) => {
    await lockWindow(db, 'signin', subject);
    await enforceWindow(db, 'signin', subject, limits.signin_limit, limits.signin_window_seconds);
    const row = await one<UserRow & { password_hash: string }>(db, 'SELECT id, name, email, confirmed, password_hash FROM users WHERE email = $1', [address]);
    if (!row || !(await passwordMatches(password, row.password_hash))) {
      await recordEvent(db, 'signin', subject);
      return null;
    }
    return { user: toUser(row), token: await startSession(db, row.id) };
  });
  if (!signedIn) throw badCredentials();
  ctx.res.setHeader('Set-Cookie', sessionCookie(signedIn.token, SESSION_SECONDS));
  return { user: signedIn.user };
}

export async function currentSession(ctx: Ctx): Promise<unknown> {
  if (!ctx.user) throw notSignedIn();
  return { user: ctx.user };
}

export async function signOut(ctx: Ctx): Promise<unknown> {
  const token = readCookie(ctx.req, SESSION_COOKIE);
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
  ctx.res.setHeader('Set-Cookie', sessionCookie('', 0));
  return undefined;
}

export async function resendConfirmation(ctx: Ctx): Promise<unknown> {
  const user = ctx.user;
  if (!user) throw notSignedIn();
  if (user.confirmed) throw conflict('already_confirmed');
  await transaction(async (db) => {
    await lockWindow(db, 'resend', user.id);
    await enforceWindow(db, 'resend', user.id, limits.resend_limit, limits.resend_window_seconds);
    await recordEvent(db, 'resend', user.id);
  });
  await sendConfirmation(user);
  return { sent: true };
}

export async function confirmAccount(ctx: Ctx): Promise<unknown> {
  const { token } = await ctx.json();
  if (typeof token !== 'string' || token === '') throw tokenInvalid();
  const claimed = await one<{ user_id: string }>(
    pool,
    `UPDATE confirm_tokens SET closed = true
      WHERE token_hash = $1 AND NOT closed AND sent_at > now() - make_interval(secs => $2) RETURNING user_id`,
    [sha256(token), limits.confirm_token_ttl_seconds],
  );
  if (!claimed) throw tokenInvalid();
  await pool.query('UPDATE users SET confirmed = true WHERE id = $1', [claimed.user_id]);
  return { confirmed: true };
}
