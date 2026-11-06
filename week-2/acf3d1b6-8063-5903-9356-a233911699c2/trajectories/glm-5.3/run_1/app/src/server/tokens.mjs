import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool } from './db.mjs';

export async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain, hash) {
  try { return await bcrypt.compare(plain, hash); } catch { return false; }
}

export function mintInviteToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function digest(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Sessions live in PostgreSQL: the users table holds a hash of the one live
 * bearer token per account, so a restart keeps people signed in and removing
 * a member ends their session at once.
 */
export async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query('UPDATE users SET session_hash = $1 WHERE id = $2', [digest(token), userId]);
  return token;
}

export async function destroySession(token) {
  if (!token) return;
  await pool.query('UPDATE users SET session_hash = NULL WHERE session_hash = $1', [digest(token)]);
}

export async function destroySessionsOfUser(userId) {
  await pool.query('UPDATE users SET session_hash = NULL WHERE id = $1', [userId]);
}

/** Validate a bearer token and return the live account, or null. */
export async function userForToken(token) {
  if (!token || typeof token !== 'string' || token.length < 20) return null;
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.email, u.role, u.workspace_id,
            w.name AS workspace_name, w.plan AS workspace_plan
       FROM users u
       JOIN workspaces w ON w.id = u.workspace_id
      WHERE u.session_hash = $1 AND u.removed_at IS NULL`,
    [digest(token)]);
  return rows[0] || null;
}

export const SESSION_COOKIE = 'kinora_session';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // seconds

export function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
