import { randomBytes, randomUUID } from "node:crypto";
import type { HubId } from "../shared/catalogue.js";
import { HOUR_MS } from "../shared/clock.js";
import { validMobile, validName, validPassword } from "../shared/accounts.js";
import type { User } from "../shared/types.js";
import { now } from "./core.js";
import { one, q } from "./db.js";
import { fail } from "./errors.js";
import { hashPassword, verifyPassword } from "./schema.js";

const SESSION_COOKIE = "malhar_session";
const SESSION_MS = 12 * HOUR_MS;

export type UserRow = {
  id: string;
  role: "rider" | "hub_host";
  name: string;
  mobile: string;
  hub: HubId | null;
  licence_number: string | null;
  licence_valid_until: string | null;
  reminders_on: boolean;
  password_hash: string | null;
};

export const serializeUser = (u: UserRow): User => ({
  id: u.id,
  role: u.role,
  name: u.name,
  mobile: u.mobile,
  hub: u.hub,
  licenceNumber: u.licence_number,
  licenceValidUntil: u.licence_valid_until,
  remindersOn: u.reminders_on,
});

export type Caller = { user: UserRow | null; sessionId: string | null; ended: boolean; expiresMs: number | null };

function sessionIdOf(cookieHeader: string | undefined): string | null {
  for (const part of (cookieHeader ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=") || null;
  }
  return null;
}

/** Who is asking, decided per request from the cookie and the app clock. */
export const ANONYMOUS: Caller = { user: null, sessionId: null, ended: false, expiresMs: null };

export async function callerOf(cookieHeader: string | undefined, nowMs: number): Promise<Caller> {
  const sid = sessionIdOf(cookieHeader);
  if (!sid) return ANONYMOUS;
  const row = await one<UserRow & { expires_ms: number; revoked: boolean }>(
    "SELECT u.*, s.expires_ms, s.revoked FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1",
    [sid],
  );
  if (!row || row.revoked) return ANONYMOUS;
  if (row.expires_ms <= nowMs) return { user: null, sessionId: sid, ended: true, expiresMs: row.expires_ms };
  return { user: row, sessionId: sid, ended: false, expiresMs: row.expires_ms };
}

export async function openSession(userId: string): Promise<string> {
  const id = randomBytes(32).toString("hex");
  const at = await now();
  await q("INSERT INTO sessions (id, user_id, created_ms, expires_ms) VALUES ($1,$2,$3,$4)", [id, userId, at, at + SESSION_MS]);
  return id;
}

export const sessionCookie = (id: string): string => `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax`;
export const clearedCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

const isText = (v: unknown): v is string => typeof v === "string";

export async function register(body: unknown): Promise<UserRow> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isText(b.name) || !validName(b.name) || !isText(b.mobile) || !validMobile(b.mobile) || !isText(b.password) || !validPassword(b.password)) throw fail("invalid_body");
  const name = b.name.trim();
  const id = randomUUID();
  const rows = await q<UserRow>(
    "INSERT INTO users (id, role, name, mobile, password_hash) VALUES ($1,'rider',$2,$3,$4) ON CONFLICT (mobile) DO NOTHING RETURNING *",
    [id, name, b.mobile, await hashPassword(b.password)],
  );
  if (!rows[0]) throw fail("mobile_taken");
  return rows[0];
}

export async function signIn(body: unknown): Promise<UserRow> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isText(b.mobile) || !isText(b.password)) throw fail("invalid_body");
  const user = await one<UserRow>("SELECT * FROM users WHERE mobile=$1", [b.mobile]);
  if (!user || !(await verifyPassword(b.password, user.password_hash))) throw fail("bad_credentials");
  return user;
}

export const endSession = (sessionId: string): Promise<unknown> => q("UPDATE sessions SET revoked=true WHERE id=$1", [sessionId]);
