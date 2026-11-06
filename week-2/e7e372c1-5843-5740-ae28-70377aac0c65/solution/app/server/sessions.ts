// Staff sign-in, cookie signing and session expiry. Idle time is real time, never the market clock.

import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { database, many, one, text, type Queryable } from "./db.ts";
import { ROLES, type Role, type StaffUser } from "../shared/domain.ts";

const SESSION_COOKIE = "tw_session";

let signingKey = "";
let idleSeconds = 0;

export function configureSessions(key: string, idle: number): void {
  signingKey = key;
  idleSeconds = idle;
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${(await derive(password, salt)).toString("hex")}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [saltHex = "", keyHex = ""] = stored.split(":");
  const expected = Buffer.from(keyHex, "hex");
  const actual = await derive(password, Buffer.from(saltHex, "hex"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function sign(sessionId: string): string {
  return createHmac("sha256", signingKey).update(sessionId).digest("hex");
}

function toRoles(value: unknown): Role[] {
  const list = Array.isArray(value) ? value : [];
  return ROLES.filter((role) => list.includes(role));
}

function toUser(row: Record<string, unknown>): StaffUser {
  return { id: text(row, "id"), name: text(row, "name"), email: text(row, "email"), roles: toRoles(row["roles"]) };
}

export async function signIn(email: string, password: string): Promise<{ user: StaffUser; cookie: string } | null> {
  const row = await one(database(), "SELECT id, name, email, roles, password_hash FROM staff_users WHERE email = $1", [email]);
  if (!row || !(await passwordMatches(password, text(row, "password_hash")))) return null;
  const user = toUser(row);
  const sessionId = randomBytes(24).toString("hex");
  await database().query("INSERT INTO staff_sessions (id, user_id) VALUES ($1, $2)", [sessionId, user.id]);
  return { user, cookie: `${sessionId}.${sign(sessionId)}` };
}

function sessionIdFrom(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== SESSION_COOKIE) continue;
    const [sessionId = "", signature = ""] = rest.join("=").split(".");
    const expected = Buffer.from(sign(sessionId));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given) ? sessionId : null;
  }
  return null;
}

export interface AuthenticatedSession {
  sessionId: string;
  user: StaffUser;
}

/** Restarts the idle period; a session idle for more than the limit, or ended, authenticates nobody. */
export async function authenticate(cookieHeader: string | undefined): Promise<AuthenticatedSession | null> {
  const sessionId = sessionIdFrom(cookieHeader);
  if (!sessionId) return null;
  const row = await one(
    database(),
    `UPDATE staff_sessions SET last_seen_at = clock_timestamp()
      WHERE id = $1 AND ended_at IS NULL
        AND clock_timestamp() - last_seen_at <= make_interval(secs => $2::double precision)
      RETURNING user_id`,
    [sessionId, idleSeconds],
  );
  if (!row) return null;
  const user = await one(database(), "SELECT id, name, email, roles FROM staff_users WHERE id = $1", [text(row, "user_id")]);
  return user ? { sessionId, user: toUser(user) } : null;
}

export async function endSession(sessionId: string): Promise<void> {
  await database().query("UPDATE staff_sessions SET ended_at = clock_timestamp() WHERE id = $1 AND ended_at IS NULL", [sessionId]);
}

export function cookieHeaderFor(value: string): string {
  return `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/`;
}

export function clearedCookieHeader(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export async function seedStaffUser(q: Queryable, name: string, email: string, roles: Role[], passwordHash: string): Promise<void> {
  await q.query(
    "INSERT INTO staff_users (name, email, password_hash, roles) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING",
    [name, email, passwordHash, roles],
  );
}

export async function listStaff(q: Queryable): Promise<Map<string, StaffUser>> {
  const rows = await many(q, "SELECT id, name, email, roles FROM staff_users");
  return new Map(rows.map((row) => [text(row, "email"), toUser(row)]));
}
