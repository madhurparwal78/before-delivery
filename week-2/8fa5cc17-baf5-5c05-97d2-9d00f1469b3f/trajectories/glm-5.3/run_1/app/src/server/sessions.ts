// Device sessions, the lockout state, CSRF and presence. The single home of
// the lockout rule and the session lifecycle.

import { randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Ctx } from "./context.js";

export interface SessionRow {
  id: string; // cookie value
  public_id: string;
  csrf_token: string;
  label: string;
  created_at: Date;
  last_seen_at: Date;
}

const BROWSER_RULES: Array<{ re: RegExp; name: string }> = [
  { re: /edg(?:e|a|ios)?\s*\/?\s*([\d.]+)/i, name: "Edge" },
  { re: /oppo|heytap|colos\b/i, name: "Opera" },
  { re: /samsungbrowser/i, name: "Samsung Internet" },
  { re: /firefox|fxios/i, name: "Firefox" },
  { re: /chrome|crios/i, name: "Chrome" },
  { re: /safari/i, name: "Safari" },
];

const OS_RULES: Array<{ re: RegExp; name: string }> = [
  { re: /windows nt/i, name: "Windows" },
  { re: /iphone|ipad|ipod/i, name: "iOS" },
  { re: /mac os x|macintosh/i, name: "macOS" },
  { re: /android/i, name: "Android" },
  { re: /cros/i, name: "ChromeOS" },
  { re: /linux/i, name: "Linux" },
];

/** `<Browser> on <OS>` read from the user agent, or `Unknown browser`. */
export function sessionLabel(userAgent: string): string {
  let browser = "Unknown browser";
  for (const rule of BROWSER_RULES) {
    if (rule.re.test(userAgent)) {
      browser = rule.name;
      break;
    }
  }
  if (browser === "Unknown browser" && /rv:|gecko/i.test(userAgent)) browser = "Unknown browser";
  for (const rule of OS_RULES) {
    if (rule.re.test(userAgent)) return `${browser} on ${rule.name}`;
  }
  return browser;
}

export function newSessionId(): string {
  return randomUUID();
}

export function newCsrfToken(): string {
  return randomBytes(24).toString("base64url");
}

export function newPublicId(): string {
  return randomBytes(9).toString("base64url");
}

export async function createSession(client: PoolClient | Pool, label: string): Promise<SessionRow> {
  const id = newSessionId();
  const publicId = newPublicId();
  const csrf = newCsrfToken();
  const now = new Date();
  await client.query(
    "INSERT INTO sessions (id, public_id, csrf_token, label, created_at, last_seen_at) VALUES ($1, $2, $3, $4, $5, $5)",
    [id, publicId, csrf, label, now]
  );
  return { id, public_id: publicId, csrf_token: csrf, label, created_at: now, last_seen_at: now };
}

/** A live session for the given cookie id, or null. Also prunes idle-ended sessions. */
export async function findSession(ctx: Ctx, id: string): Promise<SessionRow | null> {
  await pruneIdleSessions(ctx);
  const res = await ctx.pool.query<SessionRow>(
    "SELECT id, public_id, csrf_token, label, created_at, last_seen_at FROM sessions WHERE id = $1",
    [id]
  );
  return res.rows[0] ?? null;
}

/** End sessions idle past the configured period. */
export async function pruneIdleSessions(ctx: Ctx): Promise<void> {
  await ctx.pool.query("DELETE FROM sessions WHERE last_seen_at < now() - ($1 * interval '1 second')", [ctx.config.sessionIdleSeconds]);
}

/** Refresh a session's last_seen_at. */
export async function touchSession(ctx: Ctx, id: string): Promise<void> {
  await ctx.pool.query("UPDATE sessions SET last_seen_at = now() WHERE id = $1", [id]);
}

/** End a session by id (no event emission here; the caller emits). */
export async function endSession(ctx: Ctx, id: string): Promise<boolean> {
  const res = await ctx.pool.query("DELETE FROM sessions WHERE id = $1", [id]);
  await ctx.pool.query("DELETE FROM presence WHERE session_id = $1", [id]);
  return res.rowCount === 1;
}

// ---------------------------------------------------------------------------
// The lockout state. The single home of the rule.

export interface LockDecision {
  locked: boolean;
  retryAfter: number; // whole seconds, at least 1
}

function pruneTimes(times: Date[], windowSeconds: number, now: Date): Date[] {
  const cutoff = now.getTime() - windowSeconds * 1000;
  return times.filter((t) => t.getTime() >= cutoff);
}

async function readFailures(pool: Pool, identity: string, windowSeconds: number, now: Date): Promise<Date[]> {
  const res = await pool.query<{ failure_times: Date[] }>("SELECT failure_times FROM sign_in_failures WHERE identity = $1", [identity]);
  if (res.rows.length === 0) return [];
  return pruneTimes(res.rows[0].failure_times, windowSeconds, now);
}

/** Is this identity locked right now? */
export async function isLocked(pool: Pool, identity: string, windowSeconds: number): Promise<LockDecision> {
  const now = new Date();
  const times = await readFailures(pool, identity, windowSeconds, now);
  if (times.length < 5) return { locked: false, retryAfter: 0 };
  const last = times[times.length - 1];
  const liftAt = last.getTime() + windowSeconds * 1000;
  const remainMs = liftAt - now.getTime();
  if (remainMs <= 0) return { locked: false, retryAfter: 0 };
  return { locked: true, retryAfter: Math.max(1, Math.ceil(remainMs / 1000)) };
}

/** Record a failure for the identity and for the client address. */
export async function recordFailure(pool: Pool, identity: string, clientAddr: string, windowSeconds: number): Promise<void> {
  const now = new Date();
  const bodies = [identity, `addr:${clientAddr}`];
  for (const key of bodies) {
    const existing = await readFailures(pool, key, windowSeconds, now);
    const next = [...existing, now];
    await pool.query(
      `INSERT INTO sign_in_failures (identity, failure_times) VALUES ($1, $2)
       ON CONFLICT (identity) DO UPDATE SET failure_times = $2`,
      [key, next]
    );
  }
}

/** Clear the failure count for an identity (successful sign-in). */
export async function clearFailures(pool: Pool, identity: string): Promise<void> {
  await pool.query("DELETE FROM sign_in_failures WHERE identity = $1", [identity]);
}

/** A client address is locked after 50 failures within the window. */
export async function isAddrLocked(pool: Pool, clientAddr: string, windowSeconds: number): Promise<LockDecision> {
  const now = new Date();
  const times = await readFailures(pool, `addr:${clientAddr}`, windowSeconds, now);
  if (times.length < 50) return { locked: false, retryAfter: 0 };
  const last = times[times.length - 1];
  const remainMs = last.getTime() + windowSeconds * 1000 - now.getTime();
  if (remainMs <= 0) return { locked: false, retryAfter: 0 };
  return { locked: true, retryAfter: Math.max(1, Math.ceil(remainMs / 1000)) };
}
