/**
 * Accounts: signup, sign in, sign out, and the sign-in throttle. Every refusal
 * here stores nothing, and no answer reveals whether an email is registered.
 */

import type { Pool } from './db/pool.js';
import { hashPassword, newToken, standInHash, verifyPassword } from './passwords.js';

export interface Account {
  id: number;
  name: string;
  email: string;
  role: 'organiser' | 'attendee';
}

export type SigninResult =
  | { kind: 'ok'; token: string; account: Account }
  | { kind: 'invalid_credentials' }
  | { kind: 'rate_limited'; retryAfter: number };

export class EmailTaken extends Error {}

/** Name rules: 1 to 80 characters, not all whitespace, no line breaks. */
export function validName(name: unknown): name is string {
  if (typeof name !== 'string') return false;
  if (name.length < 1 || name.length > 80) return false;
  if (/[\n\r]/.test(name)) return false;
  return name.trim() !== '';
}

/**
 * Email rules: exactly one `@`, a non-empty local part and a domain containing
 * a dot. Compared and stored lower-cased.
 */
export function validEmail(email: unknown): email is string {
  if (typeof email !== 'string') return false;
  if (email.length < 3 || email.length > 320) return false;
  const at = email.indexOf('@');
  if (at < 1) return false;
  if (email.indexOf('@', at + 1) !== -1) return false;
  const domain = email.slice(at + 1);
  return domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.');
}

/** Password rules for signup: 8 to 200 characters. */
export function validSignupPassword(password: unknown): password is string {
  return typeof password === 'string' && password.length >= 8 && password.length <= 200;
}

/** The safe `next` address: same-origin paths only, keeping the query. */
export function safeNext(next: string | null): string {
  if (next === null || next === '') return '/agenda';
  if (!next.startsWith('/') || next[1] === '/' || next[1] === '\\') return '/agenda';
  return next;
}

/** Create an attendee account. Extra fields, including `role`, are ignored. */
export async function signup(
  pool: Pool,
  fields: { name: unknown; email: unknown; password: unknown },
): Promise<Account> {
  const email = (fields.email as string).toLowerCase();
  const existing = await pool.query('SELECT id FROM accounts WHERE email = $1', [email]);
  if (existing.rows.length > 0) throw new EmailTaken();
  const hash = await hashPassword(fields.password as string);
  const res = await pool.query(
    `INSERT INTO accounts (name, email, password_hash, role) VALUES ($1, $2, $3, 'attendee')
     ON CONFLICT (email) DO NOTHING RETURNING id, name, email, role`,
    [fields.name as string, email, hash],
  );
  if (res.rows.length === 0) throw new EmailTaken();
  const row = res.rows[0]!;
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    role: row.role as 'attendee',
  };
}

/**
 * Sign in. A wrong password and an unknown email answer the same way, running
 * the same slow password check, and the throttle is shared between them.
 */
export async function signin(
  pool: Pool,
  email: string,
  password: string,
  throttleWindowSeconds: number,
): Promise<SigninResult> {
  const key = email.toLowerCase();
  if (await throttled(pool, key, throttleWindowSeconds)) {
    return { kind: 'rate_limited', retryAfter: await retryAfterSeconds(pool, key, throttleWindowSeconds) };
  }
  const res = await pool.query('SELECT id, name, email, role, password_hash FROM accounts WHERE email = $1', [key]);
  const row = res.rows[0];
  const stored = row?.password_hash ?? (await standInHash());
  const ok = await verifyPassword(password, stored);
  if (!row || !ok) {
    await pool.query('INSERT INTO signin_failures (email) VALUES ($1)', [key]);
    return { kind: 'invalid_credentials' };
  }
  const token = newToken();
  await pool.query('INSERT INTO tokens (token, account_id) VALUES ($1, $2)', [token, row.id]);
  return {
    kind: 'ok',
    token,
    account: { id: Number(row.id), name: row.name, email: row.email, role: row.role as 'organiser' | 'attendee' },
  };
}

/** Is this email throttled: five or more failures inside the trailing window. */
async function throttled(pool: Pool, email: string, windowSeconds: number): Promise<boolean> {
  const res = await pool.query(
    `SELECT COUNT(*)::int AS n FROM signin_failures
      WHERE email = $1 AND at > now() - make_interval(secs => $2)`,
    [email, windowSeconds],
  );
  return res.rows[0]!.n >= 5;
}

/**
 * The whole seconds until enough failures leave the window that fewer than
 * five remain, never less than 1.
 */
async function retryAfterSeconds(pool: Pool, email: string, windowSeconds: number): Promise<number> {
  const res = await pool.query(
    `SELECT at FROM signin_failures
      WHERE email = $1 AND at > now() - make_interval(secs => $2)
      ORDER BY at DESC LIMIT 5`,
    [email, windowSeconds],
  );
  if (res.rows.length < 5) return 1;
  const oldest = new Date(res.rows[res.rows.length - 1]!.at).getTime();
  const until = oldest + windowSeconds * 1000;
  const seconds = Math.ceil((until - Date.now()) / 1000);
  return Math.max(1, seconds);
}

/** The account behind a bearer token, reading the stored role every time. */
export async function accountForToken(pool: Pool, token: string): Promise<Account | null> {
  const res = await pool.query(
    `SELECT a.id, a.name, a.email, a.role FROM tokens t JOIN accounts a ON a.id = t.account_id
      WHERE t.token = $1`,
    [token],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    role: row.role as 'organiser' | 'attendee',
  };
}

/** Sign out: the token is refused afterwards. */
export async function signout(pool: Pool, token: string): Promise<void> {
  await pool.query('DELETE FROM tokens WHERE token = $1', [token]);
}
