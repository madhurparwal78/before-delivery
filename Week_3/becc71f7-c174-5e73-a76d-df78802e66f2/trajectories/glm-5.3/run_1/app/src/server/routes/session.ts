// Sessions (DP-01).

import crypto from 'node:crypto';
import { toZ } from '../../shared/time.js';
import { ApiError } from '../errors.js';
import { hashPassword, verifyPassword } from '../seed.js';

export const SESSION_COOKIE = 'ourlet_session';

export function homeRouteFor(role: string): string {
  if (role === 'owner') return '/staff/consignors';
  if (role === 'assistant') return '/staff/pieces';
  return '/staff/sales-book';
}

/** Sign in: a wrong password, an unknown email and a removed member answer the same way (DP-01). */
export async function signIn(pool: import('../db.js').Pool, email: string, password: string, sessionSeconds: number): Promise<{ member: { id: string; name: string; email: string; role: string }; homeRoute: string; token: string; cookie: string }> {
  const { rows } = await pool.query<{ id: string; name: string; email: string; role: string; password_hash: string }>(
    'SELECT id, name, email, role, password_hash FROM members WHERE email = $1 AND removed_at IS NULL', [email]
  );
  const member = rows[0];
  if (!member || !verifyPassword(password, member.password_hash)) {
    throw new ApiError(401, 'invalid_credentials', 'That email and password don\u2019t match.');
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const startedAt = new Date();
  const endsAt = new Date(startedAt.getTime() + sessionSeconds * 1000);
  await pool.query('INSERT INTO sessions (token, member_id, started_at, ends_at) VALUES ($1, $2, $3, $4)',
    [token, member.id, startedAt, endsAt]);
  return {
    member: { id: member.id, name: member.name, email: member.email, role: member.role },
    homeRoute: homeRouteFor(member.role),
    token,
    cookie: `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`,
  };
}

export interface ResolvedSession {
  token: string;
  member: { id: string; name: string; email: string; role: string };
  /** True when the session existed but is no longer valid (ended or removed member). */
  ended: boolean;
}

/** Look up the session cookie's member; expired sessions read as ended. */
export async function resolveSession(pool: import('../db.js').Pool, cookieHeader: string | undefined, now: Date): Promise<ResolvedSession | null> {
  if (!cookieHeader) return null;
  const match = /(?:^|;\s*)ourlet_session=([^;]+)/.exec(cookieHeader);
  const token = match?.[1];
  if (!token) return null;
  const { rows } = await pool.query<{ member_id: string; name: string; email: string; role: string; removed_at: Date | null; ends_at: Date }>(
    `SELECT s.member_id, s.ends_at, m.name, m.email, m.role, m.removed_at
     FROM sessions s JOIN members m ON m.id = s.member_id WHERE s.token = $1`, [token]
  );
  const row = rows[0];
  if (!row) return null;
  const member = { id: row.member_id, name: row.name, email: row.email, role: row.role };
  if (row.removed_at !== null || row.ends_at.getTime() <= now.getTime()) {
    return { token, member, ended: true };
  }
  return { token, member, ended: false };
}

export async function endSession(pool: import('../db.js').Pool, token: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
}

export function memberJson(m: { id: string; name: string; email: string; role: string; created_at: Date }): unknown {
  return { id: m.id, name: m.name, email: m.email, role: m.role, createdAt: toZ(new Date(m.created_at)) };
}

export { hashPassword, verifyPassword };
