import { randomBytes } from "node:crypto";
import { getEvent } from "./domain/repo.js";
import { errForbidden, errNotFound, errUnauthenticated, ApiError } from "./errors.js";
import type { Db } from "./db.js";

export interface AppUser {
  id: string;
  email: string;
  name: string;
  clubId: string | null;
  isOperator: boolean;
  roles: string[];
}

declare module "fastify" {
  interface FastifyRequest {
    user: AppUser | null;
  }
}

export const SESSION_COOKIE = "paddock_session";
const SESSION_DAYS = 30;

export async function loadUser(db: Db, token: string | undefined): Promise<AppUser | null> {
  if (!token) return null;
  const rows = await db.query(
    `SELECT u.id, u.email, u.name, u.club_id, u.is_operator, u.staff_roles
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > now()`,
    [token],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id as string,
    email: row.email as string,
    name: row.name as string,
    clubId: (row.club_id as string | null) ?? null,
    isOperator: row.is_operator as boolean,
    roles: row.staff_roles as string[],
  };
}

export async function createSession(db: Db, userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.query(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + ($3 || ' days')::interval)`,
    [token, userId, SESSION_DAYS],
  );
  return token;
}

export async function destroySession(db: Db, token: string): Promise<void> {
  await db.query(`DELETE FROM sessions WHERE token = $1`, [token]);
}

/** Guards: every route calls one of these through preHandlers. */
export async function requireUser(request: { user: AppUser | null }): Promise<AppUser> {
  if (!request.user) throw errUnauthenticated();
  return request.user;
}

export function requireMember(user: AppUser, clubId: string): void {
  if (user.isOperator || user.clubId !== clubId) {
    throw user.isOperator ? errForbidden() : errNotFound();
  }
}

export function requireRole(user: AppUser, roles: string[]): void {
  if (!user.roles.some((r) => roles.includes(r))) throw errForbidden();
}

/** Operator guard: operator-only endpoints answer 403 for club users. */
export function requireOperator(user: AppUser): void {
  if (!user.isOperator) throw errForbidden();
}

/** Load an event scoped to the user's club; 404 when unknown or other-club. */
export async function scopedEvent(db: Db, user: AppUser, eventId: string) {
  const event = await getEvent(db, eventId, user.clubId);
  if (!event || user.isOperator) throw errNotFound();
  return event;
}

export function apiErrorOf(e: unknown): ApiError | null {
  return e instanceof ApiError ? e : null;
}
