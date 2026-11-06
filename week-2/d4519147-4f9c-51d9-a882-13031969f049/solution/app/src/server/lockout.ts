import { config } from "./config.ts";
import { many, one, type Db } from "./db.ts";
import { ApiError } from "./http.ts";
import { auditAccount } from "./audit.ts";

const PAIR_LIMIT = 5;
const IP_LIMIT = 20;

const pairKey = (email: string, ip: string) => `${email.toLowerCase()}|${ip}`;

/** Refuses with 429 while the email+IP pair or the IP is locked. Checked before any password. */
export async function assertNotLocked(db: Db, email: string, ip: string): Promise<void> {
  const row = await one<{ until: Date }>(
    db,
    `SELECT max(until) AS until FROM signin_locks
      WHERE until > now() AND ((scope = 'pair' AND key = $1) OR (scope = 'ip' AND key = $2))`,
    [pairKey(email, ip), ip],
  );
  if (row?.until) {
    const wait = Math.max(1, Math.ceil((row.until.getTime() - Date.now()) / 1000));
    throw new ApiError(429, "signin_locked", "Too many sign-in attempts. Try again later.", undefined, { "Retry-After": String(wait) });
  }
}

async function failuresSinceLastLock(db: Db, scope: "pair" | "ip", key: string, where: string, params: unknown[]): Promise<number> {
  const lock = await one<{ started_at: Date | null }>(db, "SELECT max(started_at) AS started_at FROM signin_locks WHERE scope = $1 AND key = $2", [scope, key]);
  const since = lock?.started_at ?? new Date(0);
  const rows = await many<{ n: string }>(
    db,
    `SELECT count(*) AS n FROM signin_failures WHERE ${where} AND at > now() - make_interval(secs => $${params.length + 1}) AND at > $${params.length + 2}`,
    [...params, config.timers.signinWindow, since],
  );
  return Number(rows[0]?.n ?? 0);
}

/** Records one failed attempt for an email+IP pair and starts any lock it completes; runs inside a transaction. `accountId` is set when the email has an account. */
export async function recordFailure(db: Db, email: string, ip: string, accountId: string | null): Promise<void> {
  const normalized = email.toLowerCase();
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`signin:${ip}`]);
  await db.query("INSERT INTO signin_failures (email, ip, at) VALUES ($1, $2, clock_timestamp())", [normalized, ip]);
  if (accountId) await auditAccount(db, accountId, normalized, "signin.failed", { ip });
  let locked = false;
  const pair = pairKey(normalized, ip);
  if ((await failuresSinceLastLock(db, "pair", pair, "email = $1 AND ip = $2 AND NOT cleared", [normalized, ip])) >= PAIR_LIMIT) {
    await db.query("INSERT INTO signin_locks (scope, key, started_at, until) VALUES ('pair', $1, clock_timestamp(), clock_timestamp() + make_interval(secs => $2))", [pair, config.timers.signinLock]);
    locked = true;
  }
  if ((await failuresSinceLastLock(db, "ip", ip, "ip = $1", [ip])) >= IP_LIMIT) {
    await db.query("INSERT INTO signin_locks (scope, key, started_at, until) VALUES ('ip', $1, clock_timestamp(), clock_timestamp() + make_interval(secs => $2))", [ip, config.timers.signinLock]);
    locked = true;
  }
  if (locked && accountId) await auditAccount(db, accountId, normalized, "signin.locked", { ip });
}

/** A successful sign-in clears that pair's failures (they still count toward the IP lock). */
export async function clearPair(db: Db, email: string, ip: string): Promise<void> {
  await db.query("UPDATE signin_failures SET cleared = true WHERE email = $1 AND ip = $2 AND NOT cleared", [email.toLowerCase(), ip]);
}
