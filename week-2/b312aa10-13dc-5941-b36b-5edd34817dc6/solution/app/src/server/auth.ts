import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { lockKey, pool, tx } from "./db.js";
import { config } from "./config.js";
import type { Role } from "../shared/rules.js";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const SESSION_DAYS = 14;
const COOKIE = "lineboard_session";

export interface Kitchen { id: string; name: string; slug: string; timeZone: string }
export interface Session {
  person: { id: string; name: string; email: string; role: Role; memberId: string | null };
  kitchen: Kitchen;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 32);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, salt, key] = stored.split("$");
  const expected = Buffer.from(key!, "base64");
  const actual = await scryptAsync(password, Buffer.from(salt!, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

export const tokenHash = (token: string): string => createHash("sha256").update(token).digest("hex");

const SESSION_COLUMNS = `p.id, p.name, p.email, p.role, p.member_id, k.id AS kitchen_id, k.name AS kitchen_name, k.slug, k.time_zone`;
const SESSION_FROM = `FROM people p JOIN kitchens k ON k.id = p.kitchen_id`;

function toSession(row: Record<string, string>): Session {
  return {
    person: { id: row.id!, name: row.name!, email: row.email!, role: row.role as Role, memberId: row.member_id ?? null },
    kitchen: { id: row.kitchen_id!, name: row.kitchen_name!, slug: row.slug!, timeZone: row.time_zone! },
  };
}

function cookieToken(header: string | undefined): string | null {
  for (const part of (header ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === COOKIE) return value.join("=");
  }
  return null;
}

export async function authenticate(cookieHeader: string | undefined): Promise<Session | null> {
  const token = cookieToken(cookieHeader);
  if (!token) return null;
  const { rows } = await pool.query(
    `SELECT ${SESSION_COLUMNS} ${SESSION_FROM} JOIN sessions s ON s.person_id = p.id WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [tokenHash(token)],
  );
  return rows[0] ? toSession(rows[0]) : null;
}

const MAX_FAILURES = 5;

type SignInResult =
  | { kind: "ok"; session: Session; token: string }
  | { kind: "invalid" }
  | { kind: "throttled"; retryAfterSeconds: number };

/**
 * The sign-in throttle. Attempts for one normalised email are settled one at a time; with 5
 * counted failures inside the window the attempt is refused without checking the password.
 * Unknown emails are counted and throttled exactly like known ones. A success ends any session
 * whose cookie came with the request and starts a new one.
 */
export async function signIn(email: string, password: string, cookieHeader: string | undefined): Promise<SignInResult> {
  const normalised = email.trim().toLowerCase();
  return tx(async (client) => {
    await lockKey(client, `signin:${normalised}`);
    // The window is the last signinWindowSeconds seconds, judged now from each failure's instant.
    const { rows: failures } = await client.query(
      `SELECT ceil(extract(epoch FROM at + make_interval(secs => $2) - clock_timestamp()))::int AS seconds_left
         FROM signin_failures WHERE email = $1 AND at > clock_timestamp() - make_interval(secs => $2) ORDER BY at`,
      [normalised, config.signinWindowSeconds],
    );
    if (failures.length >= MAX_FAILURES) {
      return { kind: "throttled", retryAfterSeconds: Math.max(1, failures[0].seconds_left as number) };
    }
    const { rows } = await client.query(`SELECT ${SESSION_COLUMNS}, p.password_hash ${SESSION_FROM} WHERE lower(p.email) = $1`, [normalised]);
    const row = rows[0];
    if (!row || !(await verifyPassword(password, row.password_hash))) {
      await client.query(
        "INSERT INTO signin_failures (email, leaves_at) VALUES ($1, clock_timestamp() + make_interval(secs => $2))",
        [normalised, config.signinWindowSeconds],
      );
      return { kind: "invalid" };
    }
    await client.query("DELETE FROM signin_failures WHERE email = $1", [normalised]);
    const previous = cookieToken(cookieHeader);
    if (previous) await client.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(previous)]);
    const token = randomBytes(32).toString("base64url");
    await client.query(
      `INSERT INTO sessions (token_hash, person_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))`,
      [tokenHash(token), row.id, SESSION_DAYS],
    );
    return { kind: "ok", session: toSession(row), token };
  });
}

export async function signOut(cookieHeader: string | undefined): Promise<void> {
  const token = cookieToken(cookieHeader);
  if (token) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
}

export function sessionCookie(token: string): string {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86_400}`;
}

export const clearedCookie = `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

export function sessionBody(s: Session): unknown {
  return { user: s.person, kitchen: s.kitchen };
}
