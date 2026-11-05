// Sessions in Postgres, shared across instances.
import type { PoolClient } from "pg";
import { randomToken, verifyPassword } from "./auth.js";
import type { Role } from "../shared/domain.js";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  family_id: string | null;
  school_id: string | null;
}

export const SESSION_COOKIE = "bellroll_session";

export async function userFromSession(
  client: PoolClient,
  token: string | null
): Promise<SessionUser | null> {
  if (!token) return null;
  const rows = await client.query<Record<string, unknown>>(
    `SELECT u.id, u.name, u.email, u.role, u.family_id, u.school_id, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1`,
    [token]
  );
  if (rows.rows.length === 0) return null;
  const row = rows.rows[0];
  const expiresAt = new Date(row.expires_at as string);
  if (expiresAt.getTime() < Date.now()) {
    await client.query("DELETE FROM sessions WHERE id = $1", [token]);
    return null;
  }
  return {
    id: row.id as string,
    name: row.name as string,
    email: row.email as string,
    role: row.role as Role,
    family_id: (row.family_id as string | null) ?? null,
    school_id: (row.school_id as string | null) ?? null,
  };
}

export async function createSession(
  client: PoolClient,
  userId: string,
  now: Date
): Promise<string> {
  const token = randomToken(32);
  await client.query(
    "INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ($1,$2,$3,$4)",
    [token, userId, now, new Date(now.getTime() + 30 * 86400_000)]
  );
  return token;
}

export async function destroySession(client: PoolClient, token: string): Promise<void> {
  await client.query("DELETE FROM sessions WHERE id = $1", [token]);
}

export async function authenticate(
  client: PoolClient,
  email: string,
  password: string
): Promise<SessionUser | null> {
  const rows = await client.query<Record<string, unknown>>(
    "SELECT * FROM users WHERE email = $1",
    [email]
  );
  if (rows.rows.length === 0) return null;
  const row = rows.rows[0];
  if (!verifyPassword(password, row.password_hash as string)) return null;
  return {
    id: row.id as string,
    name: row.name as string,
    email: row.email as string,
    role: row.role as Role,
    family_id: (row.family_id as string | null) ?? null,
    school_id: (row.school_id as string | null) ?? null,
  };
}
