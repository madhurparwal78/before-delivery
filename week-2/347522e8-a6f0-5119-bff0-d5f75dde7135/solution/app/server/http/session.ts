import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { RenterStatus, Role, UserView } from "../../shared/api.js";
import { iso, now } from "../clock.js";
import { type Db, one } from "../db.js";

const SESSION_COOKIE = "rs_session";
const SESSION_DAYS = 30;

export interface Caller {
  userId: string;
  name: string;
  email: string;
  role: Role;
  renterId: string | null;
  renterStatus: RenterStatus | null;
}

export function isStaff(caller: Caller): boolean {
  return caller.role === "operator" || caller.role === "shift_lead";
}

export function userView(caller: Caller): UserView {
  return {
    id: caller.userId,
    name: caller.name,
    email: caller.email,
    role: caller.role,
    renter_id: caller.renterId,
    renter_status: caller.renterStatus,
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function cookieToken(req: IncomingMessage): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) return value.join("=") || null;
  }
  return null;
}

interface CallerRow {
  user_id: string;
  name: string;
  email: string;
  role: Role;
  renter_id: string | null;
  renter_status: RenterStatus | null;
}

const CALLER_SQL = `
  SELECT u.id AS user_id, u.name, u.email, u.role, u.renter_id, r.status AS renter_status
  FROM users u LEFT JOIN renters r ON r.id = u.renter_id`;

function toCaller(row: CallerRow): Caller {
  return {
    userId: row.user_id,
    name: row.name,
    email: row.email,
    role: row.role,
    renterId: row.renter_id,
    renterStatus: row.renter_status,
  };
}

export async function callerFromRequest(db: Db, req: IncomingMessage): Promise<Caller | null> {
  const token = cookieToken(req);
  if (!token) return null;
  const row = await one<CallerRow>(
    db,
    `${CALLER_SQL} JOIN sessions s ON s.user_id = u.id WHERE s.token_hash = $1 AND s.expires_at > $2`,
    [hashToken(token), iso(now())],
  );
  return row ? toCaller(row) : null;
}

export async function callerByUserId(db: Db, userId: string): Promise<Caller> {
  const row = await one<CallerRow>(db, `${CALLER_SQL} WHERE u.id = $1`, [userId]);
  if (!row) throw new Error(`user ${userId} vanished`);
  return toCaller(row);
}

/** Starts a session and returns the Set-Cookie header value. */
export async function startSession(db: Db, userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)", [
    hashToken(token),
    userId,
    iso(now() + SESSION_DAYS * 86_400_000),
  ]);
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86_400}`;
}

export async function endSession(db: Db, req: IncomingMessage): Promise<string> {
  const token = cookieToken(req);
  if (token) await db.query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}
