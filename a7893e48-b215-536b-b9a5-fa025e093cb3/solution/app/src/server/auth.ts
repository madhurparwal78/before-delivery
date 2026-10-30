import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { config } from "./config.js";
import { all, one, pool, type Db } from "./db.js";
import { ApiError, cookie, type ApiRequest, type JsonObject } from "./http.js";
import type { Role } from "./rules.js";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 32);
  return `scrypt:${salt.toString("hex")}:${key.toString("hex")}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [, salt, key] = stored.split(":");
  if (!salt || !key) return false;
  const candidate = await scryptAsync(password, Buffer.from(salt, "hex"), 32);
  return timingSafeEqual(candidate, Buffer.from(key, "hex"));
}

const SESSION_COOKIE = "hs_session";
const SESSION_HOURS = 12;

const signature = (sessionId: string): string => createHmac("sha256", config.sessionSecret).update(sessionId).digest("base64url");

/** The cookie value is the session id and its HMAC under the session signing secret. */
async function startSession(userId: string): Promise<{ id: string; setCookie: string }> {
  const id = randomBytes(24).toString("base64url");
  const now = new Date();
  await pool.query("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)",
    [id, userId, now, new Date(now.getTime() + SESSION_HOURS * 3600000)]);
  return { id, setCookie: `${SESSION_COOKIE}=${id}.${signature(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}` };
}

export const CLEARED_COOKIE = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

function sessionIdOf(request: ApiRequest): string | null {
  const value = cookie(request, SESSION_COOKIE);
  if (!value) return null;
  const [id, mac] = value.split(".");
  if (!id || !mac) return null;
  const expected = Buffer.from(signature(id));
  const given = Buffer.from(mac);
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
}

export interface Actor {
  userId: string;
  sessionId: string;
  name: string;
  email: string;
  role: Role;
  operatorId: string;
  siteId: string | null;
  renterId: string | null;
  siteIds: string[];
}

interface UserRow { id: string; email: string; name: string; role: Role; operator_id: string; site_id: string | null; renter_id: string | null }

async function actorOf(db: Db, user: UserRow, sessionId: string): Promise<Actor> {
  const sites = user.role === "front_desk" && user.site_id
    ? [user.site_id]
    : (await all<{ id: string }>(db, "SELECT id FROM sites WHERE operator_id = $1 ORDER BY position", [user.operator_id])).map((site) => site.id);
  return {
    userId: user.id, sessionId, name: user.name, email: user.email, role: user.role, operatorId: user.operator_id,
    siteId: user.site_id, renterId: user.renter_id, siteIds: sites,
  };
}

/** 401 unless the request carries a valid, unexpired session. */
export async function requireActor(request: ApiRequest): Promise<Actor> {
  const sessionId = sessionIdOf(request);
  if (!sessionId) throw new ApiError(401, "unauthenticated");
  const user = await one<UserRow>(pool,
    `SELECT u.id, u.email, u.name, u.role, u.operator_id, u.site_id, u.renter_id
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1 AND s.expires_at > now()`, [sessionId]);
  if (!user) throw new ApiError(401, "unauthenticated");
  return actorOf(pool, user, sessionId);
}

export async function signIn(email: string, password: string): Promise<{ actor: Actor; setCookie: string } | null> {
  const user = await one<UserRow & { password_hash: string }>(pool, "SELECT * FROM users WHERE lower(email) = lower($1)", [email]);
  if (!user || !(await passwordMatches(password, user.password_hash))) return null;
  const session = await startSession(user.id);
  return { actor: await actorOf(pool, user, session.id), setCookie: session.setCookie };
}

export async function endSession(actor: Actor): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE id = $1", [actor.sessionId]);
}

export function userJson(actor: Actor): JsonObject {
  return {
    id: actor.userId, name: actor.name, email: actor.email, role: actor.role, operator_id: actor.operatorId,
    site_ids: actor.siteIds, renter_id: actor.renterId,
  };
}

/** Role check for endpoints whose permission is not a booking or hold action (403 forbidden). */
export function requireRole(actor: Actor, ...roles: Role[]): void {
  if (!roles.includes(actor.role)) throw new ApiError(403, "forbidden");
}
