// Sessions: the cookies, session liveness, rotation and the cap, the sign-in throttle and the CSRF check.
import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { TLSSocket } from "node:tls";
import { one, pool, rows, type Db } from "./db.ts";
import { config } from "./config.ts";
import { now } from "./clock.ts";
import type { Role } from "../shared/api.ts";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  tenantId: string;
  /** The kitchen manager's site or the member's home site; null for finance leads. */
  siteId: string | null;
  memberId: string | null;
}

const SESSION_COOKIE = "pl_session";
const CSRF_COOKIE = "pl_csrf";
const MAX_LIVE_SESSIONS = 3;
const EMAIL_FAILURE_LIMIT = 5;
const ADDRESS_FAILURE_LIMIT = 20;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sessionCookieValue(req: IncomingMessage): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) return value.join("=");
  }
  return null;
}

/** The peer address, with an IPv4-mapped IPv6 address counted as its IPv4 address; forwarding headers are ignored. */
export function clientAddress(req: IncomingMessage): string {
  return (req.socket.remoteAddress ?? "").replace(/^::ffff:/i, "");
}

const USER_SELECT = `
  SELECT u.id, u.name, u.email, u.role, u.tenant_id, u.password_hash, COALESCE(u.site_id, m.home_site_id) AS site_id, m.id AS member_id
    FROM users u LEFT JOIN members m ON m.user_id = u.id`;

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  tenant_id: string;
  site_id: string | null;
  member_id: string | null;
  password_hash: string;
}

function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    tenantId: row.tenant_id,
    siteId: row.site_id,
    memberId: row.member_id,
  };
}

interface SessionTimes {
  created_at: Date;
  last_used_at: Date;
}

/** Past the idle or the absolute limit at `at`. */
function pastLimits(s: SessionTimes, at: number): boolean {
  return at - s.last_used_at.getTime() > config.sessionIdleSeconds * 1000 || at >= s.created_at.getTime() + config.sessionAbsoluteSeconds * 1000;
}

export type SessionState =
  | { state: "none" }
  | { state: "invalid"; user: null }
  | { state: "dead"; code: "session_invalid" | "session_expired"; user: SessionUser }
  | { state: "live"; user: SessionUser; csrfHash: string; tokenHash: string };

/** Judges the request's session and, when it is live, counts this request as a use. */
export async function readSession(req: IncomingMessage): Promise<SessionState> {
  const token = sessionCookieValue(req);
  if (token === null) return { state: "none" };
  const tokenHash = digest(token);
  const row = await one<UserRow & SessionTimes & { csrf_hash: string; destroyed_at: Date | null }>(
    pool,
    `SELECT s.csrf_hash, s.created_at, s.last_used_at, s.destroyed_at, q.* FROM sessions s
       JOIN (${USER_SELECT}) q ON q.id = s.user_id WHERE s.token_hash = $1`,
    [tokenHash],
  );
  if (!row) return { state: "invalid", user: null };
  const at = now();
  const user = toSessionUser(row);
  if (pastLimits(row, at)) return { state: "dead", code: "session_expired", user };
  if (row.destroyed_at !== null) return { state: "dead", code: "session_invalid", user };
  await pool.query("UPDATE sessions SET last_used_at = GREATEST(last_used_at, $2) WHERE token_hash = $1", [tokenHash, new Date(at)]);
  return { state: "live", user, csrfHash: row.csrf_hash, tokenHash };
}

/** The double-submit check: the header must equal this session's pl_csrf value. */
export function csrfMatches(header: string | string[] | undefined, csrfHash: string): boolean {
  return typeof header === "string" && header !== "" && digest(header) === csrfHash;
}

export async function userByEmail(email: string): Promise<(SessionUser & { passwordHash: string }) | null> {
  const row = await one<UserRow>(pool, `${USER_SELECT} WHERE lower(u.email) = lower($1)`, [email]);
  return row ? { ...toSessionUser(row), passwordHash: row.password_hash } : null;
}

function cookieAttributes(req: IncomingMessage, httpOnly: boolean): string {
  const secure = (req.socket as TLSSocket).encrypted === true;
  return `${httpOnly ? "; HttpOnly" : ""}; Path=/; SameSite=Strict${secure ? "; Secure" : ""}`;
}

/**
 * A new session under fresh cookie values: the value the request carried is dead from now, and a sign-in
 * that would make a fourth live session destroys the user's oldest.
 */
export async function openSession(db: Db, req: IncomingMessage, userId: string, at: number): Promise<string[]> {
  const carried = sessionCookieValue(req);
  if (carried !== null) await db.query("UPDATE sessions SET destroyed_at = $2 WHERE token_hash = $1 AND destroyed_at IS NULL", [digest(carried), new Date(at)]);
  await db.query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [userId]);
  const open = await rows<SessionTimes & { token_hash: string }>(
    db,
    "SELECT token_hash, created_at, last_used_at FROM sessions WHERE user_id = $1 AND destroyed_at IS NULL ORDER BY created_at, seq",
    [userId],
  );
  const live = open.filter((s) => !pastLimits(s, at));
  for (const stale of live.slice(0, Math.max(0, live.length - MAX_LIVE_SESSIONS + 1))) {
    await db.query("UPDATE sessions SET destroyed_at = $2 WHERE token_hash = $1", [stale.token_hash, new Date(at)]);
  }
  const token = randomBytes(32).toString("base64url");
  const csrf = randomBytes(32).toString("base64url");
  await db.query("INSERT INTO sessions (token_hash, csrf_hash, user_id, created_at, last_used_at) VALUES ($1, $2, $3, $4, $4)", [
    digest(token),
    digest(csrf),
    userId,
    new Date(at),
  ]);
  return [`${SESSION_COOKIE}=${token}${cookieAttributes(req, true)}`, `${CSRF_COOKIE}=${csrf}${cookieAttributes(req, false)}`];
}

export async function destroySession(db: Db, tokenHash: string): Promise<void> {
  await db.query("UPDATE sessions SET destroyed_at = $2 WHERE token_hash = $1 AND destroyed_at IS NULL", [tokenHash, new Date(now())]);
}

export function clearingCookies(req: IncomingMessage): string[] {
  return [`${SESSION_COOKIE}=${cookieAttributes(req, true)}; Max-Age=0`, `${CSRF_COOKIE}=${cookieAttributes(req, false)}; Max-Age=0`];
}

/** Whole seconds, rounded up, until `count` failures no longer fall within the window; null when under the limit. */
function throttleEnd(failures: { at: Date }[], limit: number, at: number): number | null {
  if (failures.length < limit) return null;
  const decisive = failures[failures.length - limit];
  if (!decisive) return null;
  return Math.max(1, Math.ceil((decisive.at.getTime() + config.signInThrottleWindowSeconds * 1000 - at) / 1000));
}

/** The sign-in throttle: seconds until the later of the email and client address limits ends, or null. */
export async function throttleRetryAfter(db: Db, email: string, address: string, at: number): Promise<number | null> {
  const since = new Date(at - config.signInThrottleWindowSeconds * 1000);
  const byEmail = await rows<{ at: Date }>(
    db,
    "SELECT at FROM sign_in_failures WHERE email = lower($1) AND NOT cleared AND at > $2 ORDER BY at",
    [email, since],
  );
  const byAddress = await rows<{ at: Date }>(db, "SELECT at FROM sign_in_failures WHERE address = $1 AND at > $2 ORDER BY at", [address, since]);
  const ends = [throttleEnd(byEmail, EMAIL_FAILURE_LIMIT, at), throttleEnd(byAddress, ADDRESS_FAILURE_LIMIT, at)].filter((n) => n !== null);
  return ends.length > 0 ? Math.max(...ends) : null;
}

export async function recordSignInFailure(email: string, address: string, at: number): Promise<void> {
  await pool.query("INSERT INTO sign_in_failures (email, address, at) VALUES (lower($1), $2, $3)", [email, address, new Date(at)]);
}

/** A successful sign-in clears that email's failures; they still count for the client address. */
export async function clearSignInFailures(db: Db, email: string): Promise<void> {
  await db.query("UPDATE sign_in_failures SET cleared = true WHERE email = lower($1) AND NOT cleared", [email]);
}
