import { pool } from './db';
import { newId, newToken, sha256Hex } from './ids';

export type SessionUser = { id: string; email: string; name: string; role: string; teamId: string; teamName: string };

export async function hashPassword(password: string, salt?: string): Promise<string> {
  const { scrypt, timingSafeEqual, randomBytes } = await import('node:crypto');
  const useSalt = salt ?? randomBytes(16).toString('hex');
  const hash = scryptSync(password, useSalt);
  return `${useSalt}:${hash.toString('hex')}`;
}

function scryptSync(password: string, salt: string): Buffer {
  const { scryptSync: s } = require('node:crypto') as typeof import('node:crypto');
  return s(password, salt, 32);
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hashHex] = stored.split(':');
  if (!salt || !hashHex) return false;
  const { timingSafeEqual } = require('node:crypto') as typeof import('node:crypto');
  const computed = scryptSync(password, salt);
  const expected = Buffer.from(hashHex, 'hex');
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

export async function createSession(userId: string): Promise<string> {
  const token = newToken(24);
  await pool.query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [sha256Hex(token), userId]);
  return token;
}

export async function getSessionUser(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const r = await pool.query<{ id: string; email: string; name: string; role: string; team_id: string; team_name: string }>(
    `SELECT u.id, u.email, u.name, u.role, u.team_id, t.name AS team_name
     FROM sessions s JOIN users u ON u.id = s.user_id JOIN teams t ON t.id = u.team_id
     WHERE s.token = $1`, [sha256Hex(token)],
  );
  const row = r.rows[0];
  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role, teamId: row.team_id, teamName: row.team_name };
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  await pool.query('DELETE FROM sessions WHERE token = $1', [sha256Hex(token)]);
}

export function isRole(role: string, min: 'viewer' | 'editor' | 'owner'): boolean {
  const order: Record<string, number> = { viewer: 0, editor: 1, owner: 2 };
  return order[role] >= order[min];
}
