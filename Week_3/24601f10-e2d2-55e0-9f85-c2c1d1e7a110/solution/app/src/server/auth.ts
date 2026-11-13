import { randomBytes, createHash, scrypt, timingSafeEqual, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { pool, type Db } from './db.js';
import { fail } from './errors.js';
import { FIELD, MSG } from './messages.js';

export interface User { id: string; username: string }

const SESSION_COOKIE = 'cupfold_session';
const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30;
const RATE_WINDOW_MS = 60000;

const derive = (password: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => scrypt(password, salt, 64, (error, key) => (error ? reject(error) : resolve(key))));

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${(await derive(password, salt)).toString('hex')}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt, key] = stored.split(':');
  const expected = Buffer.from(key ?? '', 'hex');
  const actual = await derive(password, Buffer.from(salt ?? '', 'hex'));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');

function cookieOf(req: IncomingMessage): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return rest.join('=');
  }
  return null;
}

export async function userFor(req: IncomingMessage): Promise<User | null> {
  const token = cookieOf(req);
  if (!token) return null;
  const { rows } = await pool.query<User>(
    'SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1', [tokenHash(token)]);
  return rows[0] ?? null;
}

export async function startSession(db: Db, userId: string, now: number): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.query('INSERT INTO sessions (token_hash, user_id, created_at) VALUES ($1,$2,$3)', [tokenHash(token), userId, now]);
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_S}`;
}

export async function endSession(req: IncomingMessage): Promise<string> {
  const token = cookieOf(req);
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash(token)]);
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

const USERNAME = /^[a-z0-9_]{3,24}$/;

export async function createUser(db: Db, rawUsername: string, password: string, now: number): Promise<User> {
  const username = rawUsername.toLowerCase();
  if ((await db.query('SELECT 1 FROM users WHERE username = $1', [username])).rowCount) fail('username_taken', MSG.usernameTaken);
  const fields: Record<string, string> = {};
  if (!USERNAME.test(username)) fields['username'] = FIELD.username;
  if ([...password].length < 8) fields['password'] = FIELD.password;
  if (Object.keys(fields).length) fail('validation', MSG.checkFields, { fields });
  const id = randomUUID();
  // A racing signup passes the check above together with this one; the unique key decides, and the loser is refused cleanly.
  const inserted = await db.query(
    'INSERT INTO users (id, username, password_hash, created_at) VALUES ($1,$2,$3,$4) ON CONFLICT (username) DO NOTHING',
    [id, username, await hashPassword(password), now]);
  if (!inserted.rowCount) fail('username_taken', MSG.usernameTaken);
  return { id, username };
}

export async function verifyCredentials(username: string, password: string): Promise<User> {
  const { rows } = await pool.query<User & { password_hash: string }>(
    'SELECT id, username, password_hash FROM users WHERE username = $1', [username.toLowerCase()]);
  const row = rows[0];
  if (!row || !(await passwordMatches(password, row.password_hash))) fail('bad_credentials', MSG.badCredentials);
  return { id: row.id, username: row.username };
}

// A rolling window of attempts on server time. A refused attempt is not recorded, so the window slides.
export async function takeRateSlot(scope: 'signin' | 'match', key: string, limit: number, now: number): Promise<boolean> {
  const { rows } = await pool.query<{ count: string }>(
    'SELECT count(*) FROM rate_hits WHERE scope = $1 AND key = $2 AND at_ms > $3', [scope, key, now - RATE_WINDOW_MS]);
  if (Number(rows[0]?.count) >= limit) return false;
  await pool.query('INSERT INTO rate_hits (scope, key, at_ms) VALUES ($1,$2,$3)', [scope, key, now]);
  return true;
}
