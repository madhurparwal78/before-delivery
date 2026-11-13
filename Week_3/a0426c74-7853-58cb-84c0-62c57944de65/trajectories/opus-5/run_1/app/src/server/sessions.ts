import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiError, MESSAGES } from '../shared/errors.js';
import { config } from './config.js';
import { now } from './clock.js';
import { one, query } from './db.js';
import { newToken } from './ids.js';

const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;

export function hashPassword(password: string, salt = randomBytes(16).toString('hex')): string {
  const derived = pbkdf2Sync(password, salt, 60000, 32, 'sha256').toString('hex');
  return `${salt}:${derived}`;
}

export function passwordMatches(password: string, stored: string): boolean {
  const [salt, derived] = stored.split(':');
  if (!salt || !derived) return false;
  const candidate = pbkdf2Sync(password, salt, 60000, 32, 'sha256');
  const expected = Buffer.from(derived, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function validateCredentials(username: string, password: string): void {
  const fields: Record<string, string> = {};
  if (!USERNAME_PATTERN.test(username)) fields.username = MESSAGES.badUsername;
  if (password.length < 8) fields.password = MESSAGES.shortPassword;
  if (Object.keys(fields).length > 0) throw new ApiError('invalid', MESSAGES.invalid, { fields });
}

export async function createUser(username: string, password: string): Promise<void> {
  const existing = await one<{ username: string }>('select username from users where username = $1', [username]);
  if (existing) throw new ApiError('username_taken', MESSAGES.usernameTaken);
  await query('insert into users (username, password_hash) values ($1,$2)', [username, hashPassword(password)]);
}

export async function userExists(username: string): Promise<boolean> {
  const row = await one<{ username: string }>('select username from users where username = $1', [username]);
  return row !== null;
}

export async function startSession(username: string): Promise<string> {
  const token = newToken();
  await query('insert into sessions (token, username) values ($1,$2)', [token, username]);
  return token;
}

export async function endSession(token: string): Promise<void> {
  await query('delete from sessions where token = $1', [token]);
}

export async function usernameForToken(token: string): Promise<string | null> {
  const row = await one<{ username: string }>('select username from sessions where token = $1', [token]);
  return row ? row.username : null;
}

/** Sign-in attempts are rate limited per username. */
export async function checkLoginRate(username: string): Promise<void> {
  const cutoff = new Date(now() - 60000).toISOString();
  await query('delete from login_attempts where at < $1', [cutoff]);
  const rows = await query<{ count: string }>('select count(*) as count from login_attempts where username = $1 and at >= $2', [
    username,
    cutoff,
  ]);
  if (Number(rows[0].count) >= config.loginRate) {
    throw new ApiError('rate_limited', MESSAGES.signInRateLimit);
  }
  await query('insert into login_attempts (username, at) values ($1,$2)', [username, new Date(now()).toISOString()]);
}

export async function signIn(username: string, password: string): Promise<string> {
  const row = await one<{ username: string; password_hash: string }>(
    'select username, password_hash from users where username = $1',
    [username],
  );
  if (!row || !passwordMatches(password, row.password_hash)) {
    throw new ApiError('unauthenticated', MESSAGES.wrongCredentials);
  }
  return startSession(row.username);
}
