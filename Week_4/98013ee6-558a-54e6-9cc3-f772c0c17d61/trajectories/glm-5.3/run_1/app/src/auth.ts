import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { poolDb } from "./db";
import { businessNow } from "./clock";
import { unauthorized } from "./errors";

/** A signed-in person, with a numeric id (pg returns bigint as text). */
export interface UserRef {
  id: number;
  email: string;
  name: string;
  handle: string;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  handle: string;
}

function toRef(row: UserRow): UserRef {
  return { id: Number(row.id), email: row.email, name: row.name, handle: row.handle };
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function sessionCookie(token: string): string {
  return `ml_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=15778476`;
}

export function clearSessionCookie(): string {
  return `ml_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function createSession(userId: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await poolDb.query(
    `insert into sessions (token, user_id, created_at) values ($1, $2, $3)`,
    [token, userId, businessNow()]
  );
  return token;
}

export async function userFromRequest(req: Request): Promise<UserRef | null> {
  const token = sessionToken(req);
  if (!token) return null;
  const row = await poolDb.queryOne<UserRow>(
    `select u.id, u.email, u.name, u.handle from sessions s join users u on u.id = s.user_id where s.token = $1`,
    [token]
  );
  return row ? toRef(row) : null;
}

function sessionToken(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "ml_session") return rest.join("=");
  }
  return null;
}

/** Requires a session: the first check of the published error order. */
export async function requireUser(req: Request): Promise<UserRef> {
  const user = await userFromRequest(req);
  if (!user) throw unauthorized();
  return user;
}

export async function findUserByHandle(handle: string): Promise<UserRef | null> {
  const row = await poolDb.queryOne<UserRow>(
    `select id, email, name, handle from users where lower(handle) = lower($1)`, [handle]
  );
  return row ? toRef(row) : null;
}

export async function findUserByEmail(email: string): Promise<UserRef | null> {
  const row = await poolDb.queryOne<UserRow>(
    `select id, email, name, handle from users where lower(email) = lower($1)`, [email]
  );
  return row ? toRef(row) : null;
}
export type { UserRow };
