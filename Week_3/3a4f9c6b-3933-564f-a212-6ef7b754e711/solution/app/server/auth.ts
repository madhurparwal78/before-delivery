// Seeded people, password hashes and sessions (cookie `keelson_session`).
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { config } from "./config.js";
import type { Db } from "./db.js";
import { ApiError } from "./errors.js";
import type { Ctx } from "./http.js";

const derive = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;
const COOKIE = "keelson_session";

export interface User { id: string; email: string; name: string }

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [, salt = "", hash = ""] = stored.split("$");
  const expected = Buffer.from(hash, "base64");
  const actual = await derive(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

// Compared against when the email is unknown, so both refusals take the same time.
const UNKNOWN_USER_HASH = `scrypt$${randomBytes(16).toString("base64")}$${randomBytes(32).toString("base64")}`;

export async function signIn(db: Db, email: string, password: string, now: Date): Promise<{ user: User; cookie: string }> {
  const { rows } = await db.query<User & { password_hash: string }>(
    "SELECT id, email, name, password_hash FROM users WHERE lower(email) = lower($1)", [email]);
  const found = rows[0];
  const ok = await passwordMatches(password, found?.password_hash ?? UNKNOWN_USER_HASH);
  if (!found || !ok) throw new ApiError("invalid_credentials", "Email or password is wrong.");
  const token = randomBytes(32).toString("base64url");
  await db.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
    [sha256Hex(token), found.id, new Date(now.getTime() + config.sessionTtlSeconds * 1000)]);
  return {
    user: { id: found.id, email: found.email, name: found.name },
    cookie: `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${config.sessionTtlSeconds}`,
  };
}

function sessionToken(ctx: Ctx): string | null {
  for (const part of (ctx.req.headers.cookie ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === COOKIE) return value.join("=");
  }
  return null;
}

/** Step 3 of the error precedence: a live session. */
export async function sessionUser(db: Db, ctx: Ctx): Promise<User> {
  const token = sessionToken(ctx);
  if (token) {
    const { rows } = await db.query<User>(
      `SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > $2`, [sha256Hex(token), ctx.now]);
    if (rows[0]) return rows[0];
  }
  throw new ApiError("unauthenticated", "Sign in to continue.");
}

export async function signOut(db: Db, ctx: Ctx): Promise<string> {
  const token = sessionToken(ctx);
  if (token) await db.query("DELETE FROM sessions WHERE token_hash = $1", [sha256Hex(token)]);
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}
