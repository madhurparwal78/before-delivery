import { createHash, randomBytes } from "node:crypto";
import { config } from "./config.js";
import { one, pool, query, transaction } from "./db.js";
import { ApiError } from "./errors.js";
import { verifyPassword } from "./passwords.js";

import type { Role } from "../shared/routes.js";
export type { Role };

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  operatorId: string;
  operatorName: string;
  shopIds: string[];
  expiresAt: Date;
}

const COOKIE = "tramela_session";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function readCookie(header: string | undefined): string | null {
  for (const part of (header ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === COOKIE) return value.join("=");
  }
  return null;
}

interface SessionRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  operator_id: string;
  operator_name: string;
  expires_at: Date;
  store_ids: string[] | null;
}

export async function findSession(cookieHeader: string | undefined): Promise<SessionUser | null> {
  const token = readCookie(cookieHeader);
  if (!token) return null;
  const row = await one<SessionRow>(pool,
    `SELECT u.id, u.email, u.name, u.role, u.operator_id, o.name AS operator_name, s.expires_at,
            (SELECT array_agg(us.store_id ORDER BY us.store_id) FROM user_shops us WHERE us.user_id = u.id) AS store_ids
     FROM sessions s JOIN users u ON u.id = s.user_id JOIN operators o ON o.id = u.operator_id
     WHERE s.token_hash = $1 AND s.expires_at > $2`, [hashToken(token), new Date()]);
  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role, operatorId: row.operator_id,
    operatorName: row.operator_name, shopIds: row.store_ids ?? [], expiresAt: row.expires_at };
}

/** The person as the session endpoints show them. */
export function userJson(fields: { id: string; name: string; email: string; role: Role; operator_id: string }) {
  return { id: fields.id, name: fields.name, email: fields.email, role: fields.role, operator_id: fields.operator_id };
}

export function userObject(user: SessionUser) {
  return userJson({ id: user.id, name: user.name, email: user.email, role: user.role, operator_id: user.operatorId });
}

interface LoginRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  operator_id: string;
  password_hash: string;
  store_ids: string[] | null;
}

/** Failed sign-ins for this email inside the window, newest first. */
async function recentFailures(email: string, now: Date): Promise<Date[]> {
  const since = new Date(now.getTime() - config.signInWindowSeconds * 1000);
  const rows = await query<{ at: Date }>(pool, "SELECT at FROM sign_in_attempts WHERE email = $1 AND at > $2 ORDER BY at DESC LIMIT 5", [email, since]);
  return rows.map((row) => row.at);
}

export async function signIn(rawEmail: unknown, password: unknown, now: Date): Promise<{ token: string; user: LoginRow }> {
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  const failures = email ? await recentFailures(email, now) : [];
  const oldestOfFive = failures[4];
  if (oldestOfFive) {
    const retryAfter = Math.max(1, Math.ceil((oldestOfFive.getTime() + config.signInWindowSeconds * 1000 - now.getTime()) / 1000));
    throw new ApiError(429, "too_many_attempts", { retry_after: retryAfter });
  }
  const login = email
    ? await one<LoginRow>(pool,
      `SELECT u.id, u.email, u.name, u.role, u.operator_id, u.password_hash,
              (SELECT array_agg(us.store_id ORDER BY us.store_id) FROM user_shops us WHERE us.user_id = u.id) AS store_ids
       FROM users u WHERE u.email = $1`, [email])
    : null;
  const correct = await verifyPassword(typeof password === "string" ? password : "", login?.password_hash ?? null);
  if (!login || !correct) {
    if (email) await pool.query("INSERT INTO sign_in_attempts (email, at) VALUES ($1, $2)", [email, now]);
    throw new ApiError(401, "invalid_credentials");
  }
  const token = randomBytes(32).toString("base64url");
  await transaction(async (db) => {
    await db.query("DELETE FROM sign_in_attempts WHERE email = $1", [email]);
    await db.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
      [hashToken(token), login.id, new Date(now.getTime() + config.sessionSeconds * 1000)]);
  });
  return { token, user: login };
}

export function sessionCookie(token: string): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export async function endSession(cookieHeader: string | undefined): Promise<void> {
  const token = readCookie(cookieHeader);
  if (token) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
}

export async function purgeExpiredSessions(): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE expires_at < $1", [new Date()]);
  await pool.query("DELETE FROM sign_in_attempts WHERE at < $1", [new Date(Date.now() - config.signInWindowSeconds * 1000)]);
}
