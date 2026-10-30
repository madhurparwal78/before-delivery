import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db, one } from "../db.js";

export type Role = "learner" | "coordinator" | "planner" | "author";

export interface Organisation {
  id: string;
  slug: string;
  name: string;
  kind: "provider" | "hospital";
}

export interface SessionUser {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  organisation: Organisation | null;
  licence_number: string | null;
  date_of_birth: string | null;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  licence_number: string | null;
  date_of_birth: string | null;
  org_id: string | null;
  org_slug: string | null;
  org_name: string | null;
  org_kind: "provider" | "hospital" | null;
}

const USER_SELECT = `
  SELECT u.id, u.email, u.display_name, u.role, u.licence_number, u.date_of_birth,
         o.id AS org_id, o.slug AS org_slug, o.name AS org_name, o.kind AS org_kind
    FROM users u LEFT JOIN organisations o ON o.id = u.organisation_id`;

const toUser = (row: UserRow): SessionUser => ({
  id: row.id,
  email: row.email,
  display_name: row.display_name,
  role: row.role,
  organisation:
    row.org_id !== null && row.org_slug !== null && row.org_name !== null && row.org_kind !== null
      ? { id: row.org_id, slug: row.org_slug, name: row.org_name, kind: row.org_kind }
      : null,
  licence_number: row.licence_number,
  date_of_birth: row.date_of_birth,
});

/** The User object; only `/api/me` adds the learner's licence number and date of birth. */
export function userJson(user: SessionUser, withPrivate = false): Record<string, unknown> {
  const organisation = user.organisation ? { id: user.organisation.id, name: user.organisation.name, kind: user.organisation.kind } : null;
  const base = { id: user.id, email: user.email, display_name: user.display_name, role: user.role, organisation };
  return withPrivate && user.role === "learner" ? { ...base, licence_number: user.licence_number, date_of_birth: user.date_of_birth } : base;
}

const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt:${salt.toString("hex")}:${scryptSync(password, salt, 32).toString("hex")}`;
}

function passwordMatches(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split(":");
  if (scheme !== "scrypt" || saltHex === undefined || hashHex === undefined) return false;
  const expected = Buffer.from(hashHex, "hex");
  return timingSafeEqual(scryptSync(password, Buffer.from(saltHex, "hex"), expected.length), expected);
}

export async function userForSession(token: string): Promise<SessionUser | null> {
  const row = await one<UserRow>(db, `${USER_SELECT} JOIN sessions s ON s.user_id = u.id WHERE s.token_hash = $1`, [hashToken(token)]);
  return row ? toUser(row) : null;
}

async function userById(id: string): Promise<SessionUser | null> {
  const row = await one<UserRow>(db, `${USER_SELECT} WHERE u.id = $1`, [id]);
  return row ? toUser(row) : null;
}

/** Returns the new session token and its user, or null when the credentials do not match. */
export async function startSession(email: string, password: string, now: Date): Promise<{ token: string; user: SessionUser } | null> {
  const credentials = await one<{ id: string; password_hash: string }>(db, "SELECT id, password_hash FROM users WHERE lower(email) = lower($1)", [email]);
  if (!credentials || !passwordMatches(password, credentials.password_hash)) return null;
  const row = await one<UserRow>(db, `${USER_SELECT} WHERE u.id = $1`, [credentials.id]);
  if (!row) return null;
  const token = randomBytes(32).toString("base64url");
  await db.q("INSERT INTO sessions (token_hash, user_id, created_at) VALUES ($1, $2, $3)", [hashToken(token), row.id, now]);
  return { token, user: toUser(row) };
}

export async function endSession(token: string): Promise<void> {
  await db.q("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
}

export async function renameUser(id: string, displayName: string): Promise<SessionUser | null> {
  await db.q("UPDATE users SET display_name = $2 WHERE id = $1", [id, displayName]);
  return userById(id);
}

/** The hospital whose coordinator or nurse this user is. */
export const hospitalOf = (user: SessionUser): Organisation | null => (user.organisation?.kind === "hospital" ? user.organisation : null);
