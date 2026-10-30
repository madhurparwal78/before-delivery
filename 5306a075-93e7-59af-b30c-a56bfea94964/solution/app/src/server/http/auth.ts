// Members, passwords and sessions. Session tokens are random; only their SHA-256 is stored.
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { promisify } from "node:util";
import type { Role, User, Workspace } from "../../shared/api.js";
import { config } from "../config.js";
import { db, type Queryable } from "../db.js";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;
const SESSION_COOKIE = "evidence_session";

export interface Member extends User { workspaceId: string }
export interface Session { member: Member; workspace: Workspace; tokenHash: string }

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 32);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [, salt, hash] = stored.split("$");
  if (salt === undefined || hash === undefined) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

const digest = (token: string): string => createHash("sha256").update(token).digest("hex");

function readCookie(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export const clearedSessionCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

export async function startSession(tx: Queryable, memberId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await tx.query("INSERT INTO sessions (token_hash, member_id) VALUES ($1, $2)", [digest(token), memberId]);
  return token;
}

interface SessionRow {
  token_hash: string; member_id: string; workspace_id: string; name: string; email: string; role: Role;
  workspace_name: string; time_zone: string;
}

/** The live session behind the request's cookie, refreshed; null when absent or idle too long. */
export async function currentSession(req: IncomingMessage): Promise<Session | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const [row] = await db.query<SessionRow>(
    `UPDATE sessions s SET last_seen_at = now()
       FROM members m JOIN workspaces w ON w.id = m.workspace_id
      WHERE s.token_hash = $1 AND m.id = s.member_id AND s.last_seen_at > now() - make_interval(secs => $2)
      RETURNING s.token_hash, m.id AS member_id, m.workspace_id, m.name, m.email, m.role, w.name AS workspace_name, w.time_zone`,
    [digest(token), config.sessionIdleSeconds],
  );
  if (!row) return null;
  return {
    tokenHash: row.token_hash,
    member: { id: row.member_id, workspaceId: row.workspace_id, name: row.name, email: row.email, role: row.role },
    workspace: { id: row.workspace_id, name: row.workspace_name, timeZone: row.time_zone },
  };
}

export async function endSession(tokenHash: string): Promise<void> {
  await db.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
}

export function toUser(member: Member): User {
  return { id: member.id, name: member.name, email: member.email, role: member.role };
}
