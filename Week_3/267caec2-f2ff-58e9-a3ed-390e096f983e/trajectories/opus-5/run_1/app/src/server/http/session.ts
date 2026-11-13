import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { ServerResponse } from 'node:http';
import { pool } from '../db';
import type { Actor, UserRow } from '../domain/types';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

export const SESSION_COOKIE = 'cutline_session';

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return `${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, digest] = stored.split(':');
  const derived = await scrypt(password, salt, 64);
  const expected = Buffer.from(digest, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;
  for (const piece of header.split(';')) {
    const index = piece.indexOf('=');
    if (index === -1) continue;
    if (piece.slice(0, index).trim() === name) return decodeURIComponent(piece.slice(index + 1).trim());
  }
  return null;
}

export async function startSession(response: ServerResponse, userId: string): Promise<void> {
  const token = randomBytes(24).toString('hex');
  await pool.query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, userId]);
  response.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`);
}

export async function endSession(response: ServerResponse, token: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
  response.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

export async function actorForToken(token: string | null): Promise<Actor | null> {
  if (token === null) return null;
  const result = await pool.query<UserRow>(
    'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1',
    [token],
  );
  const user = result.rows[0];
  if (user === undefined) return null;
  return { id: user.id, role: user.role, name: user.name, email: user.email, studioId: user.studio_id };
}
