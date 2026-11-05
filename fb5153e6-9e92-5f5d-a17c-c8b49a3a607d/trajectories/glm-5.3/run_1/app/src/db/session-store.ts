import { pool, query, one } from './db.js';
import { randomToken, sha256Hex } from '../domain/ids.js';
import { ensureSchema, getConfigValue, setConfigValue } from './schema.js';
import type { Role } from '../domain/states.js';

export interface SessionUser {
  id: number;
  email: string;
  role: Role;
}

export async function initSecrets(): Promise<string> {
  await ensureSchema();
  const secret = await getConfigValue(pool, 'session_secret');
  if (secret !== null) return secret;
  const fresh = randomToken(32);
  await setConfigValue('session_secret', fresh);
  return fresh;
}

export async function createSession(userId: number): Promise<string> {
  const id = randomToken(24);
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14);
  await query('INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)', [id, userId, expires]);
  return id;
}

export async function sessionUser(sessionId: string | undefined): Promise<SessionUser | null> {
  if (sessionId === undefined) return null;
  const row = await one<{ id: string; user_id: number; email: string; role: string }>(
    `SELECT s.id, s.user_id, u.email, u.role
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND s.expires_at > now()`,
    [sessionId],
  );
  if (row === null) return null;
  return { id: row.user_id, email: row.email, role: row.role as Role };
}

export async function destroySession(sessionId: string): Promise<void> {
  await query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}

export async function findUserByEmail(email: string): Promise<{ id: number; role: string; password_hash: string } | null> {
  return one<{ id: number; role: string; password_hash: string }>(
    'SELECT id, role, password_hash FROM users WHERE lower(email) = lower($1)',
    [email],
  );
}
