// Sign-in session management and the sign-in lock (DP-01, DP-61).
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { AppConfig } from "./config.js";

export interface AuthedRequest {
  readonly accountId: string;
}

export interface SessionToken {
  readonly token: string;
  readonly expiresAtMs: number;
}

export const SESSION_COOKIE = "lowlamp_session";

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}$${sha(`${salt}:${password}`)}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, digest] = stored.split("$");
  if (!salt || !digest) return false;
  const candidate = Buffer.from(sha(`${salt}:${password}`), "hex");
  const expected = Buffer.from(digest, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export async function createSession(pool: Pool, config: AppConfig, accountId: string): Promise<SessionToken> {
  const token = randomBytes(32).toString("hex");
  const expiresAtMs = Date.now() + config.signinSessionSeconds * 1000;
  await pool.query(
    "INSERT INTO signin_sessions (id, account_id, token_hash, expires_at) VALUES ($1,$2,$3,$4)",
    [randomUUID(), accountId, sha(token), new Date(expiresAtMs)],
  );
  return { token, expiresAtMs };
}

export async function accountForSession(pool: Pool, token: string | undefined): Promise<{ id: string; email: string; display_name: string } | null> {
  if (!token) return null;
  const result = await pool.query<{ id: string; email: string; display_name: string; expires_at: Date }>(
    `SELECT a.id, a.email, a.display_name, s.expires_at
     FROM signin_sessions s JOIN accounts a ON a.id = s.account_id
     WHERE s.token_hash = $1`,
    [sha(token)],
  );
  const row = result.rows[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  return { id: row.id, email: row.email, display_name: row.display_name };
}

export async function deleteSession(pool: Pool, token: string | undefined): Promise<void> {
  if (!token) return;
  await pool.query("DELETE FROM signin_sessions WHERE token_hash = $1", [sha(token)]);
}

// ---- Sign-in lock -------------------------------------------------------

export interface LockOutcome {
  readonly locked: boolean;
  readonly retryAfterSeconds: number;
}

// Count failures for an email inside the rolling window, then decide whether
// the email is locked. Attempts are counted one at a time, so the caller
// serialises on an advisory lock per email.
export async function checkLock(pool: Pool | PoolClient, config: AppConfig, emailNormalised: string): Promise<LockOutcome> {
  const nowMs = Date.now();
  const result = await pool.query<{ failed_at: Date }>(
    "SELECT failed_at FROM signin_failures WHERE email_normalised = $1 AND failed_at > $2 ORDER BY failed_at DESC LIMIT 5",
    [emailNormalised, new Date(nowMs - config.signinLockSeconds * 1000)],
  );
  const failures = result.rows;
  if (failures.length < 5) return { locked: false, retryAfterSeconds: 0 };
  const fifth = failures.reduce((oldest, row) => {
    const time = new Date(row.failed_at).getTime();
    return time < oldest ? time : oldest;
  }, Number.MAX_SAFE_INTEGER);
  const lockEnd = fifth + config.signinLockSeconds * 1000;
  const remaining = lockEnd - nowMs;
  if (remaining <= 0) return { locked: false, retryAfterSeconds: 0 };
  return { locked: true, retryAfterSeconds: Math.max(1, Math.ceil(remaining / 1000)) };
}

export async function recordFailure(pool: Pool | PoolClient, emailNormalised: string): Promise<void> {
  await pool.query("INSERT INTO signin_failures (email_normalised, failed_at) VALUES ($1, now())", [emailNormalised]);
  await pool.query("DELETE FROM signin_failures WHERE failed_at < now() - interval '90 days'");
}

export async function resetFailures(pool: Pool | PoolClient, emailNormalised: string): Promise<void> {
  await pool.query("DELETE FROM signin_failures WHERE email_normalised = $1", [emailNormalised]);
}

export function lockKeyFor(emailNormalised: string): string {
  // A stable bigint within pg_advisory_xact_lock's signed 64-bit range.
  const digest = createHash("sha256").update(emailNormalised).digest();
  let value = 0n;
  for (let i = 0; i < 8; i++) {
    value = (value << 8n) | BigInt(digest[i]!);
  }
  return (value % 9223372036854775807n).toString();
}
