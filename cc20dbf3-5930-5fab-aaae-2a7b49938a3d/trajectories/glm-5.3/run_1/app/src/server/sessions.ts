import { Pool, PoolClient } from "pg";
import { createHmac, timingSafeEqual } from "node:crypto";
import { randomToken } from "./config";
import { readSecret, verifyPassword } from "./schema";
import { Role, SessionUser } from "./http";

export const SESSION_COOKIE = "shedline_session";

function signToken(secret: string, id: string): string {
  return createHmac("sha256", secret).update(id).digest("base64url");
}

function makeCookieValue(secret: string, sessionId: string): string {
  return `${sessionId}.${signToken(secret, sessionId)}`;
}

function parseCookieValue(secret: string, value: string): string | null {
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  const expected = signToken(secret, id);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(signatureBuffer, expectedBuffer)) return null;
  return id;
}

export function parseCookie(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const equals = trimmed.indexOf("=");
    if (equals <= 0) continue;
    if (trimmed.slice(0, equals) === name) return trimmed.slice(equals + 1);
  }
  return null;
}

export async function createSession(pool: Pool, userId: string): Promise<{ cookieValue: string; expires: Date }> {
  const sessionId = randomToken();
  await pool.query("INSERT INTO sessions (id, user_id) VALUES ($1, $2)", [sessionId, userId]);
  const secret = await readSecret(pool, "session");
  return {
    cookieValue: makeCookieValue(secret, sessionId),
    expires: new Date(Date.now() + 30 * 86400000),
  };
}

export async function resolveSession(pool: Pool, cookie: string | null): Promise<SessionUser | null> {
  if (cookie === null) return null;
  const secret = await readSecret(pool, "session");
  const sessionId = parseCookieValue(secret, cookie);
  if (sessionId === null) return null;
  const result = await pool.query(
    `SELECT u.id, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1`,
    [sessionId],
  );
  if (result.rowCount === 0) return null;
  const row = result.rows[0];
  return { id: row.id as string, name: row.name as string, role: row.role as Role };
}

export async function deleteSession(pool: Pool, cookie: string | null): Promise<void> {
  if (cookie === null) return;
  const secret = await readSecret(pool, "session");
  const sessionId = parseCookieValue(secret, cookie);
  if (sessionId === null) return;
  await pool.query("DELETE FROM sessions WHERE id = $1", [sessionId]);
}

export function cookieHeader(value: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

export function clearCookieHeader(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export { verifyPassword };

export async function findUserByEmail(client: PoolClient, email: string): Promise<{
  id: string;
  name: string;
  role: Role;
  salt: string;
  hash: string;
} | null> {
  const result = await client.query(
    "SELECT id, name, role, password_salt, password_hash FROM users WHERE email = $1",
    [email],
  );
  if (result.rowCount === 0) return null;
  const row = result.rows[0];
  return { id: row.id, name: row.name, role: row.role, salt: row.password_salt, hash: row.password_hash };
}
