// Staff sessions. The single decision point for session expiry, measured on
// real time, never on the market clock.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { pool } from "./db.js";
import type { Role, StaffUserRecord } from "./types.js";

export const SESSION_COOKIE = "tw_session";

function idleSeconds(): number {
  const raw = process.env.STAFF_SESSION_IDLE_SECONDS;
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= 0 ? parsed : 1800;
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  await pool.query(`INSERT INTO staff_sessions (token, user_id, created_at, last_used_at) VALUES ($1, $2, $3, $3)`, [
    token,
    userId,
    String(now),
  ]);
  return token;
}

export interface AuthenticatedRequest {
  user: StaffUserRecord;
  token: string;
}

export async function authenticate(token: string | undefined): Promise<AuthenticatedRequest | null> {
  if (!token) return null;
  const limit = idleSeconds() * 1000;
  const now = Date.now();
  const { rows } = await pool.query(
    `SELECT s.token, u.id, u.name, u.email, u.roles,
            CASE WHEN $2::bigint - s.last_used_at > $3::bigint THEN 'expired' ELSE 'active' END AS session_state
       FROM staff_sessions s JOIN staff_users u ON u.id = s.user_id
      WHERE s.token = $1`,
    [token, String(now), String(limit)],
  );
  if (rows.length === 0) return null;
  const row = rows[0] as {
    token: string;
    id: string;
    name: string;
    email: string;
    roles: string[];
    session_state: string;
  };
  if (row.session_state === "expired") return null;
  // Every authenticated request restarts the idle period.
  await pool.query(`UPDATE staff_sessions SET last_used_at = $2 WHERE token = $1`, [token, String(now)]);
  return {
    user: { id: row.id, name: row.name, email: row.email, roles: row.roles as Role[] },
    token: row.token,
  };
}

export async function endSession(token: string): Promise<void> {
  await pool.query(`DELETE FROM staff_sessions WHERE token = $1`, [token]);
}

export function hasRole(user: StaffUserRecord, role: Role): boolean {
  return user.roles.includes(role);
}

export { timingSafeEqual, createHmac };
