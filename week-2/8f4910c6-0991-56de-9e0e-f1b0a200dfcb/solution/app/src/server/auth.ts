// Members, passwords and sessions (the `rb_session` cookie).

import type { IncomingMessage } from "node:http";
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { ApiError } from "./errors.js";
import { config } from "./config.js";
import { exec, one, pool, type Db } from "./db.js";
import type { OfficeId } from "../shared/zones.js";

function scrypt(password: string, salt: Buffer, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, length, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export type Role = "agency_director" | "booker" | "accounts_lead" | "scout" | "talent";
export const STAFF: Role[] = ["agency_director", "booker", "accounts_lead", "scout"];

export function isRole(value: unknown): value is Role {
  return value === "talent" || STAFF.some((role) => role === value);
}

export const HOMES: Record<Role, string> = {
  agency_director: "/workspace/overview",
  booker: "/workspace/board",
  accounts_lead: "/workspace/licences",
  scout: "/workspace/applications",
  talent: "/workspace/me",
};

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  office: OfficeId;
  talentId: string | null;
}

export interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  office_id: OfficeId;
  talent_id: string | null;
}

export const MEMBER_COLUMNS = "m.id, m.name, m.email, m.role, m.office_id, m.talent_id";

export function toMember(row: MemberRow): Member {
  return { id: row.id, name: row.name, email: row.email, role: row.role, office: row.office_id, talentId: row.talent_id };
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, salt, key] = stored.split("$");
  const expected = Buffer.from(key, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

function sessionCookie(req: IncomingMessage): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === "rb_session") return value.join("=");
  }
  return null;
}

/** Step 3: `unauthenticated` without a cookie, `session_ended` after expiry or sign-out, `access_removed` after removal. */
export async function authenticate(req: IncomingMessage, now: number): Promise<Member> {
  const token = sessionCookie(req);
  if (!token) throw new ApiError(401, "unauthenticated");
  const row = await one<MemberRow & { expires_at: Date; removed_at: Date | null }>(
    pool,
    `SELECT ${MEMBER_COLUMNS}, s.expires_at, m.removed_at
       FROM sessions s JOIN members m ON m.id = s.member_id WHERE s.token_hash = $1`,
    [hashToken(token)],
  );
  if (!row || row.expires_at.getTime() <= now) throw new ApiError(401, "session_ended");
  if (row.removed_at) throw new ApiError(401, "access_removed");
  return toMember(row);
}

/** Starts a session and returns its Set-Cookie header. */
export async function startSession(db: Db, memberId: string, now: number): Promise<string> {
  const token = randomToken();
  await exec(db, "INSERT INTO sessions (token_hash, member_id, created_at, expires_at) VALUES ($1, $2, $3, $4)", [
    hashToken(token),
    memberId,
    new Date(now),
    new Date(now + config.sessionTtlSeconds * 1000),
  ]);
  return `rb_session=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export async function endSession(req: IncomingMessage): Promise<void> {
  const token = sessionCookie(req);
  if (token) await exec(pool, "DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
}

export const CLEAR_COOKIE = "rb_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
