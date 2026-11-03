import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { one, query } from './db.js';
import { newId } from './ids.js';

export const SESSION_COOKIE = 'pl_session';

export interface Account {
  id: string;
  email: string;
  name: string;
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [, saltHex, keyHex] = stored.split('$');
  if (saltHex === undefined || keyHex === undefined) return false;
  const key = await derive(password, Buffer.from(saltHex, 'hex'));
  const expected = Buffer.from(keyHex, 'hex');
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export async function findAccountByEmail(email: string): Promise<Account | undefined> {
  return one<Account>('select id, email, name from users where email = $1', [email.toLowerCase()]);
}

export async function createAccount(
  name: string,
  email: string,
  password: string,
): Promise<Account> {
  const id = newId('u');
  const hash = await hashPassword(password);
  await query('insert into users (id, email, name, password_hash) values ($1, $2, $3, $4)', [
    id,
    email.toLowerCase(),
    name,
    hash,
  ]);
  return { id, email: email.toLowerCase(), name };
}

export async function authenticate(email: string, password: string): Promise<Account | undefined> {
  const row = await one<{ id: string; email: string; name: string; password_hash: string }>(
    'select id, email, name, password_hash from users where email = $1',
    [email.toLowerCase()],
  );
  if (!row) return undefined;
  if (!(await passwordMatches(password, row.password_hash))) return undefined;
  return { id: row.id, email: row.email, name: row.name };
}

export async function createSession(userId: string): Promise<string> {
  const id = newId('s');
  await query('insert into sessions (id, user_id) values ($1, $2)', [id, userId]);
  return id;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await query('delete from sessions where id = $1', [sessionId]);
}

export function readCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export function sessionIdOf(request: IncomingMessage): string | undefined {
  return readCookies(request.headers.cookie)[SESSION_COOKIE];
}

export async function accountForRequest(request: IncomingMessage): Promise<Account | undefined> {
  const sessionId = sessionIdOf(request);
  if (sessionId === undefined) return undefined;
  return one<Account>(
    `select u.id, u.email, u.name from sessions s join users u on u.id = s.user_id
     where s.id = $1`,
    [sessionId],
  );
}

export function sessionCookie(sessionId: string): string {
  return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearedCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
