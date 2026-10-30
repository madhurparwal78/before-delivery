// Sign-in sessions: a random token in the passboard_session cookie, stored server-side as its hash.

import { createHash, randomBytes } from "node:crypto";
import type { Role, User } from "../shared/api.js";
import { now } from "./clock.js";
import type { Db } from "./db.js";

export const SESSION_COOKIE = "passboard_session";
const SESSION_HOURS = 12;

export interface SessionUser {
  id: string;
  role: Role;
  name: string;
  email: string;
  memberId: string | null;
  businessName: string | null;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(db: Db, userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const at = now();
  await db.query("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)", [
    tokenHash(token),
    userId,
    new Date(at),
    new Date(at + SESSION_HOURS * 3_600_000),
  ]);
  return token;
}

export async function sessionUser(db: Db, token: string): Promise<SessionUser | null> {
  const found = await db.query<{ id: string; role: Role; name: string; email: string; member_id: string | null; business_name: string | null }>(
    `SELECT u.id, u.role, u.name, u.email, u.member_id, m.business_name
       FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN members m ON m.id = u.member_id
      WHERE s.token_hash = $1 AND s.expires_at > $2`,
    [tokenHash(token), new Date(now())],
  );
  const row = found.rows[0];
  return row ? { id: row.id, role: row.role, name: row.name, email: row.email, memberId: row.member_id, businessName: row.business_name } : null;
}

export async function endSession(db: Db, token: string): Promise<void> {
  await db.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`;
}

export function clearedCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export function userJson(user: SessionUser): User {
  return { id: user.id, name: user.name, email: user.email, role: user.role, member_id: user.memberId, business_name: user.businessName };
}
