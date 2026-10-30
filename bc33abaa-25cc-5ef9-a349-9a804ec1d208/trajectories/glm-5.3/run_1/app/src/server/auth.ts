import type { Request } from "express";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { query } from "./db";

export type Role = "owner" | "admin" | "billing_manager" | "editor" | "viewer";

export interface MemberRow {
  id: string;
  workspace_id: string;
  name: string;
  email: string;
  role: Role;
}

export interface TokenRow {
  id: string;
  workspace_id: string;
  name: string;
  scope: "read" | "edit";
}

export interface WorkspaceRow {
  id: string;
  name: string;
  time_zone: string;
  review_links_enabled: boolean;
}

export type Caller =
  | { kind: "member"; member: MemberRow; workspace: WorkspaceRow; sessionId: string }
  | { kind: "agent"; token: TokenRow; workspace: WorkspaceRow };

export const SESSION_COOKIE = "orrery_session";

function sha(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function newSessionToken(): { token: string; hash: string } {
  const token = randomBytes(24).toString("base64url");
  return { token, hash: sha(token) };
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function newAgentSecret(): string {
  return `orr_${randomBytes(24).toString("base64url")}`;
}

export function newReviewToken(): string {
  return randomBytes(32).toString("base64url");
}

export function newInviteToken(): string {
  return randomBytes(20).toString("base64url");
}

export function hashToken(token: string): string {
  return sha(token);
}

export async function memberFromSession(token: string | undefined): Promise<Caller | null> {
  if (!token) return null;
  const res = await query(
    `SELECT m.id, m.workspace_id, m.name, m.email, m.role, m.removed_at, w.id AS ws_id, w.name AS ws_name, w.time_zone, w.review_links_enabled, s.token_hash
     FROM sessions s JOIN members m ON m.id = s.member_id JOIN workspaces w ON w.id = m.workspace_id
     WHERE s.token_hash = $1 AND m.removed_at IS NULL`,
    [sha(token)],
  );
  const row = res.rows[0] as
    | (MemberRow & { removed_at: Date | null; ws_id: string; ws_name: string; time_zone: string; review_links_enabled: boolean; token_hash: string })
    | undefined;
  if (!row) return null;
  return {
    kind: "member",
    member: { id: row.id, workspace_id: row.workspace_id, name: row.name, email: row.email, role: row.role },
    workspace: { id: row.ws_id, name: row.ws_name, time_zone: row.time_zone, review_links_enabled: row.review_links_enabled },
    sessionId: row.token_hash,
  };
}

export async function agentFromBearer(header: string | undefined): Promise<Caller | null> {
  if (!header?.startsWith("Bearer ")) return null;
  const secret = header.slice(7).trim();
  const res = await query(
    `SELECT t.id, t.workspace_id, t.name, t.scope, t.expires_at, t.revoked_at, w.name AS ws_name, w.time_zone, w.review_links_enabled
     FROM agent_tokens t JOIN workspaces w ON w.id = t.workspace_id
     WHERE t.secret_hash = $1`,
    [sha(secret)],
  );
  const row = res.rows[0] as (TokenRow & { expires_at: Date; revoked_at: Date | null; ws_name: string; time_zone: string; review_links_enabled: boolean }) | undefined;
  if (!row) return null;
  if (row.revoked_at || row.expires_at.getTime() <= Date.now()) return null;
  return {
    kind: "agent",
    token: { id: row.id, workspace_id: row.workspace_id, name: row.name, scope: row.scope },
    workspace: { id: row.workspace_id, name: row.ws_name, time_zone: row.time_zone, review_links_enabled: row.review_links_enabled },
  };
}

export async function resolveCaller(req: Request): Promise<Caller | null> {
  const auth = req.headers.authorization;
  if (auth) return agentFromBearer(auth);
  return memberFromSession(req.cookies?.[SESSION_COOKIE]);
}
