import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { db, type Queryable } from './db.js';
import { refuse } from './errors.js';
import { newToken } from './ids.js';
import { msg } from './messages.js';
import type { Role } from './model.js';

const SESSION_COOKIE = 'switchyard_session';
const MIN_PASSWORD = 8;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${(await derive(password, salt)).toString('hex')}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  const expected = Buffer.from(hash ?? '', 'hex');
  const actual = await derive(password, Buffer.from(salt ?? '', 'hex'));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function checkAccountFields(input: { name?: unknown; email?: unknown; password?: unknown }, fields: Array<'name' | 'email' | 'password'>): void {
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  if (fields.includes('name') && text(input.name).trim() === '') throw refuse.field(msg.enterName, 'name');
  if (fields.includes('email') && !EMAIL.test(text(input.email).trim())) throw refuse.field(msg.enterEmail, 'email');
  if (fields.includes('password') && text(input.password).length < MIN_PASSWORD) throw refuse.field(msg.passwordShort, 'password');
}

export async function createSession(client: Queryable, userId: string): Promise<string> {
  const token = newToken();
  await client.query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, userId]);
  return token;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`;
}

export const expiredCookie = `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;

export function tokenFrom(request: IncomingMessage): string | null {
  const header = request.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_COOKIE) return value.join('=');
  }
  return null;
}

export async function userForToken(token: string | null): Promise<SessionUser | null> {
  if (token === null) return null;
  const { rows } = await db.query<SessionUser>(
    'SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1',
    [token],
  );
  return rows[0] ?? null;
}

export async function endSession(token: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE token = $1', [token]);
}

interface Credentials {
  id: string;
  name: string;
  confirmed: boolean;
}

/** The user behind a correct email and password, or null. */
export async function verifyLogin(email: string, password: string): Promise<Credentials | null> {
  const { rows } = await db.query<Credentials & { password_hash: string }>(
    'SELECT id, name, confirmed, password_hash FROM users WHERE lower(email) = lower($1)',
    [email],
  );
  const user = rows[0];
  return user !== undefined && (await passwordMatches(password, user.password_hash)) ? user : null;
}

export async function firstWorkspaceId(client: Queryable, userId: string): Promise<string | null> {
  const { rows } = await client.query<{ workspace_id: string }>('SELECT workspace_id FROM members WHERE user_id = $1 ORDER BY seq LIMIT 1', [userId]);
  return rows[0]?.workspace_id ?? null;
}

export async function roleOf(client: Queryable, workspaceId: string, userId: string): Promise<Role | null> {
  const { rows } = await client.query<{ role: Role }>('SELECT role FROM members WHERE workspace_id = $1 AND user_id = $2', [workspaceId, userId]);
  return rows[0]?.role ?? null;
}
