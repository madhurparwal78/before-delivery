// Passwords, sessions and the signed-in member (brief: Sessions).
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { promisify } from "node:util";
import { config } from "./config";
import { one, pool, type Db } from "./db";
import { ApiError, parseCookies } from "./http";

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;

const SESSION_COOKIE = "tw_session";

export type Role = "fleet_director" | "charter_manager" | "finance_lead" | "captain" | "crew_member";
export const ROLES: readonly Role[] = ["fleet_director", "charter_manager", "finance_lead", "captain", "crew_member"];

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  workspaceSlug: string;
  workspaceName: string;
  yachtId: string | null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

const DECOY = hashPassword(randomBytes(12).toString("hex"));

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const [, salt, key] = (stored ?? (await DECOY)).split("$");
  const derived = await scrypt(password, Buffer.from(salt, "base64"), 32);
  return stored !== null && timingSafeEqual(derived, Buffer.from(key, "base64"));
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function startSession(memberId: string): Promise<{ token: string; maxAge: number }> {
  const token = randomBytes(32).toString("base64url");
  await pool.query(
    "INSERT INTO sessions (token_hash, member_id, created_at, expires_at) VALUES ($1, $2, now(), now() + make_interval(secs => $3))",
    [tokenHash(token), memberId, config.timers.sessionSeconds],
  );
  return { token, maxAge: config.timers.sessionSeconds };
}

export async function endSession(req: IncomingMessage): Promise<void> {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) await pool.query("UPDATE sessions SET ended_at = now() WHERE token_hash = $1 AND ended_at IS NULL", [tokenHash(token)]);
}

export function sessionCookie(token: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
}

interface SessionRow {
  ended: boolean;
  expired: boolean;
  removed: boolean;
  id: string;
  name: string;
  email: string;
  role: Role;
  workspace_slug: string;
  workspace_name: string;
  yacht_id: string | null;
}

/** The signed-in member, or the brief's 401 for a missing, ended or removed session. */
export async function authenticate(req: IncomingMessage): Promise<Member> {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) throw new ApiError(401, { error: "unauthenticated" });
  const row = await one<SessionRow>(
    pool,
    `SELECT s.ended_at IS NOT NULL AS ended, s.expires_at <= now() AS expired, m.removed_at IS NOT NULL AS removed,
            m.id, m.name, m.email, m.role, m.workspace_slug, w.name AS workspace_name, m.yacht_id
       FROM sessions s JOIN members m ON m.id = s.member_id JOIN workspaces w ON w.slug = m.workspace_slug
      WHERE s.token_hash = $1`,
    [tokenHash(token)],
  );
  if (!row) throw new ApiError(401, { error: "unauthenticated" });
  if (row.removed) throw new ApiError(401, { error: "access_removed" });
  if (row.ended || row.expired) throw new ApiError(401, { error: "session_ended" });
  return toMember(row);
}

function toMember(row: SessionRow): Member {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    workspaceSlug: row.workspace_slug,
    workspaceName: row.workspace_name,
    yachtId: row.yacht_id,
  };
}

/** The member a fresh session belongs to. */
export async function sessionMember(memberId: string): Promise<Member> {
  const row = await one<SessionRow>(
    pool,
    `SELECT false AS ended, false AS expired, false AS removed, m.id, m.name, m.email, m.role, m.workspace_slug,
            w.name AS workspace_name, m.yacht_id
       FROM members m JOIN workspaces w ON w.slug = m.workspace_slug WHERE m.id = $1`,
    [memberId],
  );
  return toMember(row!);
}

export async function memberByEmail(db: Db, email: string): Promise<{ id: string; password_hash: string } | undefined> {
  return one(db, "SELECT id, password_hash FROM members WHERE lower(email) = lower($1) AND removed_at IS NULL", [email]);
}

export const HOME: Record<Role, string> = {
  fleet_director: "fleet",
  charter_manager: "holds",
  finance_lead: "charters",
  captain: "today",
  crew_member: "today",
};
