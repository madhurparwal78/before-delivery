// Session and account handling.
import type { IncomingMessage } from 'node:http';
import { db } from './db.js';
import { hashPassword, verifyPassword, newId, sessionToken } from './ids.js';
import type { UserRow } from './types.js';

export const SESSION_COOKIE = 'pl_session';

export async function userFromRequest(req: IncomingMessage): Promise<UserRow | null> {
  const cookie = readCookie(req.headers.cookie, SESSION_COOKIE);
  if (!cookie) return null;
  const res = await db.query<UserRow>(
    'SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1', [cookie]);
  return res.rows[0] ?? null;
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export interface SignupResult { user: UserRow; sessionTokenValue: string }
export interface FieldErrors { fields: Record<string, string> }

export function validateSignup(name: unknown, email: unknown, password: unknown): FieldErrors | { name: string; email: string; password: string } {
  const fields: Record<string, string> = {};
  const n = typeof name === 'string' ? name.trim() : '';
  const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const p = typeof password === 'string' ? password : '';
  if (n.length < 1 || n.length > 80) fields.name = 'Enter a name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) fields.email = 'Enter an email address like name@example.org.';
  if (p.length < 10) fields.password = 'Use 10 or more characters.';
  if (Object.keys(fields).length) return { fields };
  return { name: n, email: e, password: p };
}

export async function createUser(name: string, email: string, password: string): Promise<UserRow> {
  const id = newId('u');
  await db.query('INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4)',
    [id, name, email, hashPassword(password)]);
  return { id, name, email };
}

export async function findUserByEmail(email: string): Promise<(UserRow & { password_hash: string }) | null> {
  const res = await db.query<UserRow & { password_hash: string }>(
    'SELECT id, name, email, password_hash FROM users WHERE email = $1', [email]);
  return res.rows[0] ?? null;
}

export async function checkPassword(user: { password_hash: string }, password: string): Promise<boolean> {
  return verifyPassword(password, user.password_hash);
}

export async function createSession(userId: string): Promise<string> {
  const token = sessionToken();
  await db.query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, userId]);
  return token;
}

export async function destroySession(token: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE token = $1', [token]);
}

export function sessionCookieHeader(value: string, clear = false): string {
  const base = `${SESSION_COOKIE}=${clear ? '' : encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`;
  return clear ? base + '; Max-Age=0' : base;
}
