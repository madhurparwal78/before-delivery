// Passwords (scrypt) and sessions. A session is a random opaque token whose SHA-256 lives in
// Postgres, so every app process sharing the database accepts it and signing out ends it everywhere.

import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { Role } from "../shared/api.js";
import { config } from "./config.js";
import { db } from "./db.js";
import { ApiError } from "./errors.js";
import { col, only, type Queryable, type Row } from "./postgres.js";

export const SESSION_COOKIE = "sh_session";
const KEY_LENGTH = 32;
const FAILED_LIMIT = 5;

interface CallerBase {
  userId: string;
  email: string;
  displayName: string;
}

export interface TenantCaller extends CallerBase {
  role: "tenant";
  tenantId: string;
}

export interface StaffCaller extends CallerBase {
  role: Exclude<Role, "tenant">;
  tenantId: null;
}

export type Caller = TenantCaller | StaffCaller;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { N: 16384, r: 8, p: 1 }, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64")}$${(await derive(password, salt)).toString("base64")}`;
}

const DECOY = `scrypt$${Buffer.alloc(16).toString("base64")}$${Buffer.alloc(KEY_LENGTH).toString("base64")}`;

/** Checks a password; with no stored hash it still spends the same work so timing reveals nothing. */
async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const [, salt = "", hash = ""] = (stored ?? DECOY).split("$");
  const expected = Buffer.from(hash, "base64");
  const actual = await derive(password, Buffer.from(salt, "base64"));
  return stored !== null && expected.length === actual.length && timingSafeEqual(expected, actual);
}

function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function startSession(tx: Queryable, userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await tx.query("INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)", [digest(token), userId]);
  return token;
}

export async function endSession(token: string): Promise<void> {
  await db.query("DELETE FROM sessions WHERE token_hash = $1", [digest(token)]);
}

function callerFrom(row: Row): Caller {
  const role = col.text(row, "role");
  const base = { userId: col.text(row, "id"), email: col.text(row, "email"), displayName: col.text(row, "display_name") };
  return role === "owner" || role === "shift_lead"
    ? { ...base, role, tenantId: null }
    : { ...base, role: "tenant", tenantId: col.text(row, "tenant_id") };
}

export async function sessionCaller(token: string): Promise<Caller | null> {
  const [row] = await db.query(
    `SELECT u.id, u.role, u.email, u.display_name, u.tenant_id
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.created_at > now() - interval '30 days'`,
    [digest(token)],
  );
  return row ? callerFrom(row) : null;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
}

export const CLEARED_COOKIE = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

const LIMIT_MESSAGE = "Too many sign-in attempts for that email. Try again in a few minutes.";

/**
 * The sign-in limit, shared by sign-in and password confirmation: with five or more failures for an
 * email inside the window (and since its last success) every attempt answers 429 without checking the
 * password. Unknown emails count the same. Times are whole seconds, like every published time, so a
 * Retry-After read against the published clock is exact. The per-email advisory lock makes the count exact across processes.
 */
async function underLimit(tx: Queryable, email: string): Promise<void> {
  const window = config.signinWindowSeconds;
  await tx.query("SELECT pg_advisory_xact_lock(hashtext('signin:' || $1))", [email]);
  const counted = only(await tx.query(
    `SELECT count(*)::int AS failures,
            extract(epoch FROM min(at) + make_interval(secs => $2) - date_trunc('second', now()))::int AS retry
       FROM signin_attempts WHERE email = $1 AND at > date_trunc('second', now()) - make_interval(secs => $2)`,
    [email, window],
  ));
  if (col.int(counted, "failures") >= FAILED_LIMIT) {
    const retry = Math.min(window, Math.max(1, col.intOrNull(counted, "retry") ?? window));
    throw new ApiError(429, "too_many_attempts", LIMIT_MESSAGE, undefined, { "Retry-After": String(retry) });
  }
}

const normalised = (email: string): string => email.trim().toLowerCase();

export async function signIn(rawEmail: string, password: string): Promise<{ caller: Caller; token: string }> {
  const email = normalised(rawEmail);
  const result = await db.transaction(async (tx) => {
    await underLimit(tx, email);
    const [row] = await tx.query("SELECT id, role, email, display_name, tenant_id, password_hash FROM users WHERE lower(email) = $1", [email]);
    if (!(await verifyPassword(password, row ? col.text(row, "password_hash") : null)) || !row) {
      await tx.query("INSERT INTO signin_attempts (email, at) VALUES ($1, date_trunc('second', now()))", [email]);
      return null;
    }
    await tx.query("DELETE FROM signin_attempts WHERE email = $1", [email]);
    const caller = callerFrom(row);
    return { caller, token: await startSession(tx, caller.userId) };
  });
  if (!result) throw new ApiError(401, "invalid_credentials", "That email and password don't match an account.");
  return result;
}

/** A correct password records the confirmation time on the session; a wrong one counts as a failed sign-in. */
export async function confirmPassword(caller: Caller, token: string, password: string): Promise<void> {
  const email = normalised(caller.email);
  const confirmed = await db.transaction(async (tx) => {
    await underLimit(tx, email);
    const [row] = await tx.query("SELECT password_hash FROM users WHERE id = $1", [caller.userId]);
    if (!row || !(await verifyPassword(password, col.text(row, "password_hash")))) {
      await tx.query("INSERT INTO signin_attempts (email, at) VALUES ($1, date_trunc('second', now()))", [email]);
      return false;
    }
    await tx.query("DELETE FROM signin_attempts WHERE email = $1", [email]);
    await tx.query("UPDATE sessions SET confirmed_at = date_trunc('second', now()) WHERE token_hash = $1", [digest(token)]);
    return true;
  });
  if (!confirmed) throw new ApiError(401, "invalid_credentials", "That password doesn't match your account.");
}

/** The step-up check: a money action needs a password confirmed less than REAUTH_SECONDS ago. */
export async function requireFreshConfirmation(token: string): Promise<void> {
  const [row] = await db.query(
    "SELECT confirmed_at IS NOT NULL AND date_trunc('second', now()) < confirmed_at + make_interval(secs => $2) AS fresh FROM sessions WHERE token_hash = $1",
    [digest(token), config.reauthSeconds],
  );
  if (!row || row.fresh !== true) throw new ApiError(403, "reauth_required", "Confirm your password to continue.");
}
