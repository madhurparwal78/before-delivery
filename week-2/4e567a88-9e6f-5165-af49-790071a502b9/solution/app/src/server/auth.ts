// Who is calling, in which context, and the same-origin rule for cookie-authenticated writes.
// A Bearer key is the API context; the session cookie is the playground context.

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { one, pool } from "./db";
import type { Context } from "./domain/policy";
import type { Role, Viewer } from "./domain/visibility";
import { fail } from "./errors";
import type { Req } from "./http";
import { sha256 } from "./store";

interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  team_id: string | null;
}

export interface Caller extends Member, Viewer {
  context: Context;
}

const SESSION_COOKIE = "dispatch_session";
const MEMBER_COLUMNS = "m.id, m.name, m.email, m.role, m.team_id";

function sessionToken(req: Req): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) return value.join("=");
  }
  return null;
}

function bearer(req: Req): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : "";
}

function isWrite(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "DELETE";
}

/** Steps 2 and 3 of the precedence: 401 for no valid credential, then 403 for a cross-origin cookie write. */
export async function authenticate(req: Req): Promise<Caller> {
  const key = bearer(req);
  if (key !== null) {
    const member = key
      ? await one<Member>(pool, `SELECT ${MEMBER_COLUMNS} FROM members m WHERE m.api_key_hash = $1`, [sha256(key)])
      : undefined;
    if (!member) fail("unauthenticated");
    return { ...member, context: "api" };
  }
  const token = sessionToken(req);
  const member = token
    ? await one<Member>(pool,
      `SELECT ${MEMBER_COLUMNS} FROM sessions s JOIN members m ON m.id = s.member_id WHERE s.token_hash = $1`,
      [sha256(token)])
    : undefined;
  if (!member) fail("unauthenticated");
  const origin = req.headers.origin;
  if (isWrite(req.method) && origin && hostOf(origin) !== req.headers.host) fail("cross_origin");
  return { ...member, context: "playground" };
}

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

/** Step 6: the role table. */
export function allow(caller: Caller, ...roles: Role[]): void {
  if (!roles.includes(caller.role)) fail("forbidden");
}

/** Step 5 for team-scoped reads: a member reaches only their own team. */
export function teamVisible(caller: Caller, teamId: string): boolean {
  return caller.role !== "member" || caller.team_id === teamId;
}

function verifyPasscode(passcode: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  return timingSafeEqual(Buffer.from(hash, "hex"), scryptSync(passcode, salt, 32));
}

export async function signIn(email: string, passcode: string): Promise<{ member: Member; token: string } | null> {
  const found = await one<Member & { passcode_hash: string }>(pool,
    `SELECT ${MEMBER_COLUMNS}, m.passcode_hash FROM members m WHERE lower(m.email) = lower($1)`, [email]);
  if (!found || !verifyPasscode(passcode, found.passcode_hash)) return null;
  const token = randomBytes(32).toString("hex");
  await pool.query("INSERT INTO sessions (token_hash, member_id, created_at) VALUES ($1, $2, now())", [sha256(token), found.id]);
  const { passcode_hash: _hash, ...member } = found;
  return { member, token };
}

export async function signOut(req: Req): Promise<void> {
  const token = sessionToken(req);
  if (token) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [sha256(token)]);
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict`;
}

export const clearedCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
