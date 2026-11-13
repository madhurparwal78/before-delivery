import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { type Db, one, pool } from "./db.js";

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;

export type Role = "coordinator" | "interpreter" | "client_scheduler" | "billing_admin";

export interface Organisation {
  id: string;
  name: string;
  code: string;
}

export interface User {
  id: string;
  role: Role;
  displayName: string;
  email: string;
  organisation: Organisation | null;
}

export const SESSION_COOKIE = "relay_session";
const SESSION_HOURS = 12;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [, salt, hash] = stored.split("$");
  const expected = Buffer.from(hash ?? "", "base64");
  const actual = await scrypt(password, Buffer.from(salt ?? "", "base64"), expected.length || 32);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// Compared against when the email is unknown, so a miss costs the same time as a wrong password.
const unknownPersonHash = hashPassword(randomBytes(16).toString("hex"));

const tokenHash = (token: string): string => createHash("sha256").update(token).digest("hex");

interface PersonRow {
  id: string;
  role: Role;
  display_name: string;
  email: string;
  password_hash: string;
  organisation_id: string | null;
  organisation_name: string | null;
  organisation_code: string | null;
}

const PERSON_SELECT = `
  SELECT p.id, p.role, p.display_name, p.email, p.password_hash, p.organisation_id,
         o.name AS organisation_name, o.code AS organisation_code
  FROM people p LEFT JOIN organisations o ON o.id = p.organisation_id`;

function toUser(row: PersonRow): User {
  return {
    id: row.id,
    role: row.role,
    displayName: row.display_name,
    email: row.email,
    organisation:
      row.organisation_id && row.organisation_name && row.organisation_code
        ? { id: row.organisation_id, name: row.organisation_name, code: row.organisation_code }
        : null,
  };
}

/** Checks the email and password and opens a session; null when either is wrong. */
export async function signIn(email: string, password: string): Promise<{ user: User; token: string } | null> {
  const row = await one<PersonRow>(pool, `${PERSON_SELECT} WHERE lower(p.email) = lower($1)`, [email]);
  const matches = await passwordMatches(password, row?.password_hash ?? (await unknownPersonHash));
  if (!row || !matches) return null;
  const token = randomBytes(32).toString("base64url");
  await pool.query(
    `INSERT INTO sessions (token_hash, person_id, expires_at) VALUES ($1, $2, now() + make_interval(hours => $3))`,
    [tokenHash(token), row.id, SESSION_HOURS],
  );
  return { user: toUser(row), token };
}

export async function userForToken(token: string): Promise<User | null> {
  const row = await one<PersonRow>(
    pool,
    `${PERSON_SELECT} JOIN sessions s ON s.person_id = p.id WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [tokenHash(token)],
  );
  return row ? toUser(row) : null;
}

export async function signOut(db: Db, token: string): Promise<void> {
  await db.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_HOURS * 3600}`;
}

export const clearedSessionCookie = `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

/** The user JSON every endpoint returns. */
export function userJson(user: User): Record<string, unknown> {
  return {
    id: user.id,
    role: user.role,
    display_name: user.displayName,
    email: user.email,
    organisation: user.organisation,
  };
}
