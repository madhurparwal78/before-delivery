// Desks' passwords and sessions. The server alone decides when a session ends.

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { promisify } from 'node:util';
import { config } from './config';
import { one, pool, type Runner } from './db';

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;

export interface Desk {
  id: string;
  name: string;
  email: string;
}

export type SessionRead =
  | { state: 'live'; desk: Desk; token: string }
  | { state: 'ended' }
  | { state: 'none' };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 32);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

export async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt = '', key = ''] = stored.split(':');
  const candidate = await scrypt(password, Buffer.from(salt, 'hex'), 32);
  return timingSafeEqual(candidate, Buffer.from(key, 'hex'));
}

function sessionCookie(req: IncomingMessage): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [name, value] = part.trim().split('=');
    if (name === 'session' && value) return value;
  }
  return null;
}

export async function readSession(req: IncomingMessage): Promise<SessionRead> {
  const token = sessionCookie(req);
  if (!token) return { state: 'none' };
  const row = await one<Desk>(
    pool,
    `SELECT d.id, d.name, d.email FROM sessions s JOIN desks d ON d.id = s.desk_id WHERE s.token = $1 AND s.ends_at > $2`,
    [token, new Date()],
  );
  return row ? { state: 'live', desk: { id: row.id, name: row.name, email: row.email }, token } : { state: 'ended' };
}

/** Opens a session and answers the cookie header that carries it. */
export async function openSession(db: Runner, deskId: string, now: number): Promise<Record<string, string>> {
  const token = randomBytes(24).toString('hex');
  await db.query('INSERT INTO sessions (token, desk_id, ends_at) VALUES ($1, $2, $3)', [token, deskId, new Date(now + config.sessionSeconds * 1000)]);
  return { 'Set-Cookie': `session=${token}; Path=/; HttpOnly; SameSite=Lax` };
}
