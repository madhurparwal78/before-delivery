import type { Db, Queryable } from "../db.js";
import { row } from "../db.js";
import { errors } from "./errors.js";
import { newSessionToken } from "../domain/passwords.js";
import type { Auth } from "./router.js";

export interface UserRow {
  id: string;
  role: "director" | "juror" | "studio";
  name: string;
  email: string;
  password_hash: string;
  studio_id: string | null;
}

export function projectUser(user: Pick<UserRow, "id" | "role" | "name" | "email" | "studio_id">, studioName: string | null): Record<string, unknown> {
  return {
    id: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
    studioId: user.studio_id,
    studioName,
  };
}

export async function userById(db: Queryable, id: string): Promise<UserRow | null> {
  return row<UserRow>(db, "SELECT * FROM users WHERE id = $1", [id]);
}

export async function userByEmail(db: Queryable, email: string): Promise<UserRow | null> {
  return row<UserRow>(db, "SELECT * FROM users WHERE lower(email) = lower($1)", [email]);
}

export async function authForSession(db: Queryable, token: string): Promise<Auth | null> {
  const found = await row<{ id: string; role: "director" | "juror" | "studio"; name: string; email: string; studio_id: string | null; studio_name: string | null }>(db, `
    SELECT u.id, u.role, u.name, u.email, u.studio_id, s.name AS studio_name
    FROM sessions se
    JOIN users u ON u.id = se.user_id
    LEFT JOIN studios s ON s.id = u.studio_id
    WHERE se.token = $1
  `, [token]);
  if (!found) {
    return null;
  }
  return {
    userId: found.id,
    role: found.role,
    name: found.name,
    email: found.email,
    studioId: found.studio_id,
    studioName: found.studio_name,
  };
}

export function sessionCookie(token: string): string {
  return `cutline_session=${token}; HttpOnly; SameSite=Lax; Path=/`;
}

export function clearedSessionCookie(): string {
  return "cutline_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";
}

export async function createSession(db: Db, userId: string): Promise<string> {
  const token = newSessionToken();
  await db.query("INSERT INTO sessions (token, user_id) VALUES ($1, $2)", [token, userId]);
  return token;
}

export async function destroySession(db: Db, token: string): Promise<void> {
  await db.query("DELETE FROM sessions WHERE token = $1", [token]);
}

export function sessionTokenFromCookie(cookie: string | undefined): string | null {
  if (!cookie) {
    return null;
  }
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "cutline_session") {
      return rest.join("=");
    }
  }
  return null;
}

export function requireAuth(auth: Auth | null): Auth {
  if (!auth) {
    throw errors.unauthenticated();
  }
  return auth;
}

export function requireRole(auth: Auth | null, role: "director" | "juror" | "studio"): Auth {
  const current = requireAuth(auth);
  if (current.role !== role) {
    throw errors.forbidden();
  }
  return current;
}

export function requireSignedIn(auth: Auth | null): Auth {
  return requireAuth(auth);
}
