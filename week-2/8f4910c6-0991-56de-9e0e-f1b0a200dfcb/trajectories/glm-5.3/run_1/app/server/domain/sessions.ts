import type { Request } from "express";
import { query, one } from "../db.js";
import { config } from "../config.js";
import { randomToken } from "../../shared/domain.js";
import { toInstant } from "../../shared/instants.js";
import { errors } from "../http/errors.js";

export interface SessionMember {
  id: string;
  name: string;
  email: string;
  role: string;
  office: string;
  talentId: string | null;
}

export interface AuthContext {
  member: SessionMember;
  sessionToken: string;
}

export function memberRow(row: { id: string; name: string; email: string; role: string; office: string; talent_id: string | null }): SessionMember {
  return { id: row.id, name: row.name, email: row.email, role: row.role, office: row.office, talentId: row.talent_id };
}

export async function createSession(memberId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(40);
  const expiresAt = new Date(Date.now() + config.sessionTtlSeconds * 1000);
  await query(`INSERT INTO sessions (token, member_id, expires_at) VALUES ($1, $2, $3)`, [token, memberId, expiresAt]);
  return { token, expiresAt };
}

export function sessionCookie(token: string, expiresAt: Date): string {
  return `rb_session=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}`;
}

export function clearedCookie(): string {
  return `rb_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function loadAuth(req: Request): Promise<AuthContext | null> {
  const header = req.headers.cookie || "";
  const match = /(?:^|;\s*)rb_session=([^;]+)/.exec(header);
  if (!match) return null;
  const token = match[1];
  const row = await one<{ token: string; expires_at: Date; ended_at: Date | null; member_id: string }>(
    `SELECT s.token, s.expires_at, s.ended_at, s.member_id, m.removed_at, m.name, m.email, m.role, m.office, m.talent_id
     FROM sessions s JOIN members m ON m.id = s.member_id WHERE s.token = $1`,
    [token]
  );
  if (!row) return null;
  const now = new Date();
  const r = row as unknown as { token: string; expires_at: Date; ended_at: Date | null; member_id: string; removed_at: Date | null; name: string; email: string; role: string; office: string; talent_id: string | null };
  if (r.removed_at) throw errors.accessRemoved();
  if (r.ended_at || r.expires_at <= now) throw errors.sessionEnded();
  const member: SessionMember = { id: r.member_id, name: r.name, email: r.email, role: r.role, office: r.office, talentId: r.talent_id };
  return { member, sessionToken: token };
}

export async function endSession(token: string): Promise<void> {
  await query(`UPDATE sessions SET ended_at = now() WHERE token = $1 AND ended_at IS NULL`, [token]);
}

export async function endSessionsOfMember(memberId: string): Promise<void> {
  await query(`UPDATE sessions SET ended_at = now() WHERE member_id = $1 AND ended_at IS NULL`, [memberId]);
}

export function publicMember(m: SessionMember): { id: string; name: string; email: string; role: string; office: string; talentId: string | null } {
  return { id: m.id, name: m.name, email: m.email, role: m.role, office: m.office, talentId: m.talentId };
}

export function instantOut(d: Date | null): string | null {
  return d ? toInstant(d) : null;
}
