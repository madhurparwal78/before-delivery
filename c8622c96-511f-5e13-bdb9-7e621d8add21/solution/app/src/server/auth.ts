// Sign-in, sessions and roles.
import type { IncomingMessage } from "node:http";
import { randomBytes } from "node:crypto";
import { ApiError, cookies, forbidden } from "./http.js";
import { one, query } from "./db.js";
import { passwordMatches } from "./passwords.js";

export type Role = "contributor" | "picture_editor" | "licensing_manager" | "desk_editor" | "treasurer";

export interface Newsroom {
  slug: string;
  name: string;
  home_zone: string;
}

export interface Person {
  id: string;
  name: string;
  email: string;
  role: Role;
  newsroom: Newsroom | null;
  handle: string | null;
}

export const SESSION_COOKIE = "saltprint_session";

interface PersonRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  handle: string | null;
  password_hash: string;
  slug: string | null;
  newsroom_name: string | null;
  home_zone: string | null;
}

const PERSON_SQL = `SELECT p.id, p.name, p.email, p.role, p.handle, p.password_hash,
  n.slug, n.name AS newsroom_name, n.home_zone
  FROM people p LEFT JOIN newsrooms n ON n.slug = p.newsroom`;

function toPerson(row: PersonRow): Person {
  return {
    id: row.id, name: row.name, email: row.email, role: row.role, handle: row.handle,
    newsroom: row.slug ? { slug: row.slug, name: row.newsroom_name ?? "", home_zone: row.home_zone ?? "" } : null,
  };
}

export function userBody(person: Person): Record<string, unknown> {
  return {
    user: {
      id: person.id, name: person.name, email: person.email, role: person.role,
      newsroom: person.newsroom, contributor_handle: person.handle,
    },
  };
}

export async function signIn(email: string, password: string): Promise<{ person: Person; token: string }> {
  const row = await one<PersonRow>(`${PERSON_SQL} WHERE lower(p.email) = lower($1)`, [email]);
  if (!row || !(await passwordMatches(password, row.password_hash))) {
    throw new ApiError(401, "invalid_credentials", "That email and password don't match a Saltprint account.");
  }
  const token = randomBytes(32).toString("base64url");
  await query("INSERT INTO sessions (token, person_id) VALUES ($1, $2)", [token, row.id]);
  return { person: toPerson(row), token };
}

export async function signOut(req: IncomingMessage): Promise<void> {
  const token = cookies(req)[SESSION_COOKIE];
  if (token) await query("DELETE FROM sessions WHERE token = $1", [token]);
}

export async function personFromRequest(req: IncomingMessage): Promise<Person | null> {
  const token = cookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const row = await one<PersonRow>(`${PERSON_SQL} JOIN sessions s ON s.person_id = p.id WHERE s.token = $1`, [token]);
  return row ? toPerson(row) : null;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export const clearedSessionCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

export function requireRole(person: Person, ...roles: Role[]): void {
  if (!roles.includes(person.role)) throw forbidden();
}

export const isNewsroomRole = (person: Person): boolean =>
  person.role === "picture_editor" || person.role === "licensing_manager";

/** The newsroom of a picture editor or licensing manager; callers have already checked the role. */
export function newsroomOf(person: Person): Newsroom {
  if (!person.newsroom) throw forbidden();
  return person.newsroom;
}
