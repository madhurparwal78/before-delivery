import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Ctx } from './http.ts';
import { bodyObject, sendJson } from './http.ts';
import { pool, type Db } from './db.ts';
import { EMAIL_PATTERN } from './engine/index.ts';
import { signInFailed, signInRequired, validationFailed } from './errors.ts';
import { M74, M75, M76, M77 } from '../shared/messages.ts';
import { now } from './time.ts';

// Accounts are email and password only (brief: Accounts and visibility).

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;
const KEY_LENGTH = 32;
const MIN_PASSWORD = 8;
export const SESSION_COOKIE = 'nf_session';
const SESSION_DAYS = 30;

export interface User { id: string; name: string; email: string }

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LENGTH);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const attempt = await scryptAsync(password, Buffer.from(salt, 'hex'), KEY_LENGTH);
  return timingSafeEqual(attempt, Buffer.from(hash, 'hex'));
}

export const validEmail = (value: unknown): value is string => typeof value === 'string' && EMAIL_PATTERN.test(value.trim());
export const emailKey = (email: string): string => email.trim().toLowerCase();

export async function createSession(userId: string, db: Db = pool): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.query('INSERT INTO sessions (token, user_id, created_at) VALUES ($1, $2, $3)', [token, userId, now()]);
  return token;
}

function sessionCookie(token: string | null): string {
  const age = token ? `Max-Age=${SESSION_DAYS * 24 * 3600}` : 'Max-Age=0';
  return `${SESSION_COOKIE}=${token ?? ''}; HttpOnly; SameSite=Lax; Path=/; ${age}`;
}

export async function userForSession(token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const { rows } = await pool.query<User>(
    'SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1', [token],
  );
  return rows[0] ?? null;
}

/** Owner routes: 401 SIGN_IN_REQUIRED without a valid session. */
export async function requireUser(ctx: Ctx): Promise<User> {
  const user = await userForSession(ctx.cookies[SESSION_COOKIE]);
  if (!user) throw signInRequired();
  return user;
}

/** Null when another sign-up took the email first: the unique key decides, so a race makes one account. */
async function createUser(name: string, email: string, password: string): Promise<User | null> {
  const id = randomUUID();
  const { rowCount } = await pool.query(
    `INSERT INTO users (id, name, email, email_key, password_hash, created_at) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (email_key) DO NOTHING`,
    [id, name, email.trim(), emailKey(email), await hashPassword(password), now()],
  );
  return rowCount ? { id, name, email: email.trim() } : null;
}

export async function signUp(ctx: Ctx): Promise<void> {
  const body = bodyObject(ctx);
  const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
  const email = body['email'];
  const password = typeof body['password'] === 'string' ? body['password'] : '';
  const items = [];
  if (!name) items.push({ key: 'name', message: M74 });
  if (!validEmail(email)) items.push({ key: 'email', message: M75 });
  if (password.length < MIN_PASSWORD) items.push({ key: 'password', message: M76 });
  if (items.length === 0 && validEmail(email)) {
    const taken = await pool.query('SELECT 1 FROM users WHERE email_key = $1', [emailKey(email)]);
    if (taken.rowCount) items.push({ key: 'email', message: M77 });
  }
  if (items.length || !validEmail(email)) throw validationFailed(items);
  const user = await createUser(name, email, password);
  if (!user) throw validationFailed([{ key: 'email', message: M77 }]);
  ctx.setCookies.push(sessionCookie(await createSession(user.id)));
  sendJson(ctx, 201, { user });
}

export async function signIn(ctx: Ctx): Promise<void> {
  const body = bodyObject(ctx);
  const email = typeof body['email'] === 'string' ? emailKey(body['email']) : '';
  const password = typeof body['password'] === 'string' ? body['password'] : '';
  const { rows } = await pool.query<User & { password_hash: string }>(
    'SELECT id, name, email, password_hash FROM users WHERE email_key = $1', [email],
  );
  const row = rows[0];
  if (!row || !(await passwordMatches(password, row.password_hash))) throw signInFailed();
  ctx.setCookies.push(sessionCookie(await createSession(row.id)));
  sendJson(ctx, 200, { user: { id: row.id, name: row.name, email: row.email } });
}

export async function currentSession(ctx: Ctx): Promise<void> {
  sendJson(ctx, 200, { user: await requireUser(ctx) });
}

export async function signOut(ctx: Ctx): Promise<void> {
  const token = ctx.cookies[SESSION_COOKIE];
  if (token) await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
  ctx.setCookies.push(sessionCookie(null));
  ctx.res.writeHead(204, { 'Set-Cookie': ctx.setCookies, 'Cache-Control': 'no-store' });
  ctx.res.end();
}
