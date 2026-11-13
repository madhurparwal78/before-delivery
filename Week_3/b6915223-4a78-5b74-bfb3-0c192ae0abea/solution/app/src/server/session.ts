import { createHash, randomBytes } from "node:crypto";
import type { Role } from "../shared/api.ts";
import { pool } from "./db.ts";

// Server-side sessions in Postgres behind the HTTP-only `elevens_session` cookie (brief: API).
const COOKIE = "elevens_session";

export interface Session {
  tokenHash: string;
  managerId: string;
  email: string;
  teamName: string;
  role: Role;
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function startSession(managerId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO sessions (token_hash, manager_id) VALUES ($1, $2)", [hash(token), managerId]);
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export function endedSessionCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function endSession(session: Session): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE token_hash = $1", [session.tokenHash]);
}

export async function readSession(cookieHeader: string | undefined): Promise<Session | null> {
  const token = cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!token) return null;
  const tokenHash = hash(token);
  const found = await pool.query<{ id: string; email: string; team_name: string; role: Role }>(
    "SELECT m.id, m.email, m.team_name, m.role FROM sessions s JOIN managers m ON m.id = s.manager_id WHERE s.token_hash = $1",
    [tokenHash],
  );
  const row = found.rows[0];
  return row ? { tokenHash, managerId: row.id, email: row.email, teamName: row.team_name, role: row.role } : null;
}
