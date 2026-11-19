import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { SessionUser } from "../shared/api";
import { pool, queryOne } from "./db";
import type { Db } from "./db";

const SESSION_COOKIE = "wb_session";
const SESSION_DAYS = 30;

export function newToken(): string {
  return randomBytes(24).toString("base64url");
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString("base64url")}`;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function cookieValue(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export async function openSession(db: Db, userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.query(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))",
    [hashToken(token), userId, SESSION_DAYS],
  );
  return token;
}

export async function closeSession(token: string): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`;
}

export const clearedSessionCookie = `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

export function sessionToken(req: IncomingMessage): string | null {
  return cookieValue(req, SESSION_COOKIE);
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  verified: boolean;
}

export function toSessionUser(row: UserRow): SessionUser {
  return { id: row.id, email: row.email, displayName: row.display_name, verified: row.verified };
}

export async function userFromRequest(req: IncomingMessage): Promise<SessionUser | null> {
  const token = sessionToken(req);
  if (!token) return null;
  const row = await queryOne<UserRow>(
    pool,
    `SELECT u.id, u.email, u.display_name, u.verified FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  return row ? toSessionUser(row) : null;
}
