import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { Role, SessionUser } from "../shared/api.js";
import { one, pool } from "./db.js";
import { ApiError } from "./errors.js";

export const SESSION_COOKIE = "paddock_session";
const SESSION_DAYS = 30;

export interface Auth {
  userId: number;
  name: string;
  email: string;
  roles: Role[];
  club: { id: number; slug: string; name: string; timeZone: string } | null;
}

/** The club columns of a `left join clubs c`, as one value that is null exactly when the user has no club. */
export const CLUB_COLUMNS = `case when c.id is null then null
       else jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name, 'timeZone', c.time_zone) end as club`;

/** An authenticated member of a club (everyone except the operator). */
export type ClubAuth = Auth & { club: NonNullable<Auth["club"]> };

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${(await derive(password, salt)).toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt = "", hash = ""] = stored.split(":");
  const expected = Buffer.from(hash, "hex");
  const actual = await derive(password, Buffer.from(salt, "hex"));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const digest = (token: string): string => createHash("sha256").update(token).digest("hex");

export async function createSession(userId: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await pool.query(
    "insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + make_interval(days => $3))",
    [digest(token), userId, SESSION_DAYS],
  );
  return token;
}

export const SESSION_MAX_AGE_SECONDS = SESSION_DAYS * 24 * 3600;

export async function destroySession(token: string): Promise<void> {
  await pool.query("delete from sessions where token_hash = $1", [digest(token)]);
}

interface AuthRow {
  user_id: number;
  name: string;
  email: string;
  roles: Role[];
  club: Auth["club"];
}

export async function authFromToken(token: string): Promise<Auth | null> {
  const row = await one<AuthRow>(
    pool,
    `select u.id as user_id, u.name, u.email, u.roles, ${CLUB_COLUMNS}
       from sessions s join users u on u.id = s.user_id left join clubs c on c.id = u.club_id
      where s.token_hash = $1 and s.expires_at > now()`,
    [digest(token)],
  );
  if (!row) return null;
  return { userId: row.user_id, name: row.name, email: row.email, roles: row.roles, club: row.club };
}

export function sessionUser(auth: Auth): SessionUser {
  return {
    id: auth.userId,
    name: auth.name,
    email: auth.email,
    roles: auth.roles,
    club: auth.club ? { slug: auth.club.slug, name: auth.club.name, timeZone: auth.club.timeZone } : null,
  };
}

/** Club endpoints are for club members; the operator has no club. */
export function memberOf(auth: Auth): ClubAuth {
  if (auth.club === null) throw new ApiError("forbidden");
  return { ...auth, club: auth.club };
}

/** The chair may do everything the timing chief and worker chief may. */
export function can(auth: Auth, role: "chair" | "timing" | "workers"): boolean {
  return auth.roles.includes("chair") || auth.roles.includes(role);
}

export function requireRole(auth: Auth, role: "chair" | "timing" | "workers"): void {
  if (!can(auth, role)) throw new ApiError("forbidden");
}
