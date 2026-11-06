import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { config } from "./config";
import { maybeOne, pool, type Db } from "./db";
import { fail } from "./errors";

// Accounts and sessions: salted scrypt password hashes and opaque session tokens whose
// hash is stored in Postgres, ended on sign-out, password change or idle timeout.

const SESSION_COOKIE = "snaglight_session";

export interface PersonRow {
  id: string;
  firm_id: string;
  name: string;
  email: string;
  is_owner: boolean;
}

export interface Auth {
  person: PersonRow;
  tokenHash: string;
}

const SCRYPT: ScryptOptions = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, 32, SCRYPT, (error, key) => (error ? reject(error) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, key] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64");
  const actual = await derive(password, Buffer.from(salt, "base64"));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Starts a session and returns the Set-Cookie header value. */
export async function startSession(db: Db, personId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.query("INSERT INTO sessions (token_hash, person_id) VALUES ($1, $2)", [hashToken(token), personId]);
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export const CLEARED_COOKIE = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

function tokenFrom(headers: IncomingMessage["headers"]): string | null {
  for (const part of (headers.cookie ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) return value.join("=") || null;
  }
  return null;
}

/** Resolves the caller's live session, refreshing its idle clock, or answers 401. */
export async function authenticate(headers: IncomingMessage["headers"]): Promise<Auth> {
  const token = tokenFrom(headers);
  if (!token) fail("unauthenticated");
  const tokenHash = hashToken(token);
  const person = await maybeOne<PersonRow>(
    pool,
    `WITH live AS (
       UPDATE sessions SET last_seen_at = clock_timestamp()
       WHERE token_hash = $1 AND last_seen_at > clock_timestamp() - make_interval(mins => $2)
       RETURNING person_id
     )
     SELECT p.id, p.firm_id, p.name, p.email, p.is_owner FROM people p JOIN live ON live.person_id = p.id`,
    [tokenHash, config.sessionIdleMinutes],
  );
  if (!person) {
    await pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
    fail("unauthenticated");
  }
  return { person, tokenHash };
}

export async function endSession(db: Db, tokenHash: string): Promise<void> {
  await db.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
}

/** Ends every session of a person except the one that asked. */
export async function endOtherSessions(db: Db, personId: string, keepTokenHash: string): Promise<void> {
  await db.query("DELETE FROM sessions WHERE person_id = $1 AND token_hash <> $2", [personId, keepTokenHash]);
}
