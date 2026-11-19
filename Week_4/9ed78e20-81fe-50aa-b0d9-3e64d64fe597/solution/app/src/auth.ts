import {
  randomBytes,
  createHash,
  scryptSync,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
  hkdfSync,
} from "node:crypto";
import type { IncomingMessage } from "node:http";
import { config } from "./config.js";
import { pool, transaction, type DB } from "./db.js";
import { grantActive } from "./domain.js";
import { fail, forbidden, authorDenied, str } from "./errors.js";
import { normalizeEmail } from "./domain.js";
import type { Grant, Staff, Role } from "./types.js";
export const digest = (token: string): string =>
  createHash("sha256").update(token).digest("hex");
export const capability = (): string => randomBytes(32).toString("base64url");
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 32).toString("hex")}`;
}
function passwordMatches(password: string, stored: string): boolean {
  const [salt, hex] = stored.split(":");
  const hash = scryptSync(password, salt, 32);
  return timingSafeEqual(hash, Buffer.from(hex, "hex"));
}
export async function staffRoles(
  db: DB,
  email: string,
): Promise<Staff["roles"]> {
  return (
    await db.query<{ data: Grant }>(
      "SELECT data FROM grants WHERE staff_email=$1",
      [email],
    )
  ).rows
    .map((r) => r.data)
    .filter(grantActive)
    .map((g) => ({ role: g.role, expires_at: g.expires_at }));
}
const sessionToken = (req: IncomingMessage): string | undefined =>
  req.headers.cookie
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("aldermoor_session="))
    ?.split("=")[1];
export const sessionCookie = (token: string, age: number): string =>
  `aldermoor_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}`;
export async function sessionStaff(
  req: IncomingMessage,
): Promise<Staff | null> {
  const cookie = sessionToken(req);
  if (!cookie) return null;
  const r = await pool.query<{ email: string; name: string }>(
    "SELECT s.email,staff.name FROM sessions s JOIN staff ON staff.email=s.email WHERE digest=$1 AND s.expires_at>now()",
    [digest(cookie)],
  );
  const row = r.rows[0];
  return row ? { ...row, roles: await staffRoles(pool, row.email) } : null;
}
export async function requireStaff(req: IncomingMessage): Promise<Staff> {
  const staff = await sessionStaff(req);
  if (!staff) fail(401, "unauthenticated", "Sign in to continue.");
  return staff;
}
export function requireNonAuthor(author: string, actor: string): void {
  if (author === actor) authorDenied();
}
export function requireRole(staff: Staff, ...roles: Role[]): void {
  if (!staff.roles.some((x) => roles.includes(x.role))) forbidden();
}
// A fixed hash so unknown emails cost the same scrypt work as known ones.
const unknownHash = hashPassword(randomBytes(16).toString("hex"));
const lockedError = (seconds: number): never =>
  fail(
    429,
    "signin_locked",
    `Too many failed sign-ins for this email. Try again in ${seconds} seconds.`,
    undefined,
    { "Retry-After": String(seconds) },
  );
// Five consecutive failures lock an email; each failure after a lock doubles it, up to eight times.
export async function signIn(
  body: Record<string, unknown>,
): Promise<{ staff: Staff; token: string }> {
  const email = normalizeEmail(str(body.email));
  type Outcome = { staff: Staff; token: string } | { locked: number } | null;
  const outcome = await transaction(async (db): Promise<Outcome> => {
    await db.query(
      "INSERT INTO signin_failures(email) VALUES($1) ON CONFLICT(email) DO NOTHING",
      [email],
    );
    const lock = (
      await db.query<{
        failures: number;
        lock_seconds: number;
        remaining: number | null;
      }>(
        "SELECT failures,lock_seconds,CEIL(EXTRACT(EPOCH FROM locked_until-now()))::int AS remaining FROM signin_failures WHERE email=$1 FOR UPDATE",
        [email],
      )
    ).rows[0];
    if (lock.remaining !== null && lock.remaining > 0)
      return { locked: Math.max(1, lock.remaining) };
    const row = (
      await db.query<{ name: string; password_hash: string }>(
        "SELECT name,password_hash FROM staff WHERE email=$1",
        [email],
      )
    ).rows[0];
    const matches = passwordMatches(
      str(body.password),
      row?.password_hash || unknownHash,
    );
    if (row && matches) {
      await db.query("DELETE FROM signin_failures WHERE email=$1", [email]);
      const token = capability();
      await db.query(
        "INSERT INTO sessions(digest,email,expires_at) VALUES($1,$2,now()+make_interval(secs=>$3))",
        [digest(token), email, config.sessionTtl],
      );
      return {
        staff: { email, name: row.name, roles: await staffRoles(db, email) },
        token,
      };
    }
    const failures = lock.failures + 1;
    const seconds = lock.lock_seconds
      ? Math.min(lock.lock_seconds * 2, config.signinLockout * 8)
      : failures >= 5
        ? config.signinLockout
        : 0;
    await db.query(
      "UPDATE signin_failures SET failures=$2,lock_seconds=$3,locked_until=CASE WHEN $3::int>0 THEN now()+make_interval(secs=>$3) END WHERE email=$1",
      [email, failures, seconds],
    );
    return null;
  });
  if (!outcome)
    fail(
      401,
      "invalid_credentials",
      "That email and password do not match a staff account.",
    );
  if ("locked" in outcome) return lockedError(outcome.locked);
  return outcome;
}
export async function signOut(req: IncomingMessage): Promise<void> {
  const cookie = sessionToken(req);
  if (cookie)
    await pool.query("DELETE FROM sessions WHERE digest=$1", [digest(cookie)]);
}
// Live tracking links are kept encrypted so later emails can carry them; the key is purpose-bound.
const linkKey = Buffer.from(
  hkdfSync("sha256", config.s3SecretKey, "", "aldermoor tracking links", 32),
);
export function encryptToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", linkKey, iv);
  const bytes = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString("base64");
}
export function decryptToken(encrypted: string): string {
  const b = Buffer.from(encrypted, "base64");
  const decipher = createDecipheriv("aes-256-gcm", linkKey, b.subarray(0, 12));
  decipher.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([
    decipher.update(b.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
}
