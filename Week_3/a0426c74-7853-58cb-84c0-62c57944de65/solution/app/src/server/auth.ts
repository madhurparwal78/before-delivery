import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { promisify } from 'node:util';
import * as copy from '../shared/copy.ts';
import { ApiError, firstByOrder, fieldsError } from '../shared/errors.ts';
import { objectBody, stringField } from './body.ts';
import { config } from './config.ts';
import { db, isUniqueViolation } from './db.ts';
import { RateLimiter } from './ratelimit.ts';
import { route, type RequestContext, type User } from './router.ts';

const SESSION_COOKIE = 'plot_session';
const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;
const MIN_PASSWORD_LENGTH = 8;
const KEY_BYTES = 64;
// scrypt at N = 2^14, r = 8, p = 1: the scrypt paper's interactive-login cost (16 MiB, tens of ms per password), cheap enough
// that a full minute's sign-in allowance per username is checked within that minute rather than aging out of the window.
const SCRYPT_COST = { N: 2 ** 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const scryptAsync = promisify<string, Buffer, number, typeof SCRYPT_COST, Buffer>(scrypt);
const loginLimiter = new RateLimiter(config.loginRate);

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

// ---------------------------------------------------------------- passwords

/** `<salt>:<key>`, both hex, with a random salt per password. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_BYTES, SCRYPT_COST);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

/** What an unknown username is checked against, so that knowing a username costs the same time as not knowing it. */
const unknownUserHash = hashPassword(randomBytes(16).toString('hex'));

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt, key] = stored.split(':');
  const expected = Buffer.from(key, 'hex');
  const actual = await scryptAsync(password, Buffer.from(salt, 'hex'), expected.length, SCRYPT_COST);
  return timingSafeEqual(expected, actual);
}

// ---------------------------------------------------------------- sessions

/** Starts a session for `username` and returns the `Set-Cookie` header value for it. */
export async function startSession(username: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.query('INSERT INTO sessions (token_hash, username) VALUES ($1, $2)', [sha256(token), username]);
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`;
}

function sessionToken(headers: IncomingMessage['headers']): string | null {
  for (const part of (headers.cookie ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_COOKIE) return value.join('=');
  }
  return null;
}

/** The person behind the request's `plot_session` cookie, or null. */
export async function authenticate(headers: IncomingMessage['headers']): Promise<User | null> {
  const token = sessionToken(headers);
  if (!token) return null;
  const session = sha256(token);
  const rows = await db.query<{ username: string }>('SELECT username FROM sessions WHERE token_hash = $1', [session]);
  return rows.length === 1 ? { username: rows[0].username, session } : null;
}

export function requireUser(ctx: RequestContext): User {
  if (!ctx.user) throw new ApiError('unauthenticated', copy.UNAUTHENTICATED);
  return ctx.user;
}

// ---------------------------------------------------------------- accounts

export const normalizeUsername = (raw: string): string => raw.trim().toLowerCase();
export const isUsername = (username: string): boolean => USERNAME_PATTERN.test(username);

route('POST', '/api/auth/register', async (ctx) => {
  const body = objectBody(ctx.json());
  const username = normalizeUsername(stringField(body, 'username'));
  const password = stringField(body, 'password');
  const fields: Record<string, string> = {};
  if (!isUsername(username)) fields.username = copy.BAD_USERNAME;
  if (password.length < MIN_PASSWORD_LENGTH) fields.password = copy.SHORT_PASSWORD;
  const invalid = Object.keys(fields).length > 0 ? fieldsError(fields) : null;
  const taken = !fields.username && (await db.query('SELECT 1 FROM users WHERE username = $1', [username])).length > 0;
  const refusal = firstByOrder([invalid, taken ? new ApiError('username_taken', copy.USERNAME_TAKEN) : null].filter((e) => e !== null));
  if (refusal) throw refusal;
  try {
    await db.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', [username, await hashPassword(password)]);
  } catch (error) {
    if (isUniqueViolation(error)) throw new ApiError('username_taken', copy.USERNAME_TAKEN);
    throw error;
  }
  return ctx.reply(201, { username }, { 'set-cookie': await startSession(username) });
}, { access: 'public' });

route('POST', '/api/auth/login', async (ctx) => {
  const body = objectBody(ctx.json());
  const username = normalizeUsername(stringField(body, 'username'));
  const password = stringField(body, 'password');
  // Every spelling that cannot be a username shares one count, so a flood of long made-up names cannot fill the counters' memory.
  if (!loginLimiter.take(isUsername(username) ? username : '')) throw new ApiError('rate_limited', copy.TOO_MANY_SIGN_INS);
  const rows = await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE username = $1', [username]);
  const matches = await passwordMatches(password, rows[0]?.password_hash ?? (await unknownUserHash));
  if (rows.length === 0 || !matches) throw new ApiError('unauthenticated', copy.WRONG_CREDENTIALS);
  return ctx.reply(200, { username }, { 'set-cookie': await startSession(username) });
}, { access: 'public' });

route('POST', '/api/auth/logout', async (ctx) => {
  if (ctx.user) await db.query('DELETE FROM sessions WHERE token_hash = $1', [ctx.user.session]);
  return ctx.reply(204, undefined, { 'set-cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` });
}, { access: 'public' });

route('GET', '/api/me', async (ctx) => ctx.reply(200, { username: requireUser(ctx).username }));
