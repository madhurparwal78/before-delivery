import { randomBytes } from "node:crypto";
import { query } from "./db.ts";

export type SessionUser = {
  id: string;
  email: string;
  display_name: string;
  role: "learner" | "coordinator" | "planner" | "author";
  organisation_id: string | null;
  licence_number: string | null;
  date_of_birth: string | null;
};

export const SESSION_COOKIE = "credwell_session";

const TTL_MS = 12 * 60 * 60 * 1000;

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await query(`INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)`, [token, userId, new Date(Date.now() + TTL_MS)]);
  return token;
}

export async function loadSession(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const { rows } = await query<SessionUser>(
    `SELECT u.id, u.email, u.display_name, u.role, u.organisation_id, u.licence_number,
            to_char(u.date_of_birth, 'YYYY-MM-DD') AS date_of_birth
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = $1 AND s.expires_at > now()`,
    [token],
  );
  return rows[0] ?? null;
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  await query(`DELETE FROM sessions WHERE token = $1`, [token]);
}

export const newToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");
