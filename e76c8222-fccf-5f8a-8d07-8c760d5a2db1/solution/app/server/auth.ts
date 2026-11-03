// Sessions: an HttpOnly, SameSite=Lax cookie holding a random token; only its hash is stored.
import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { User } from "../shared/api.js";
import { one, pool } from "./db.js";

const COOKIE = "sw_session";
const LIFETIME_S = 7 * 24 * 3600;

const hash = (token: string): string => createHash("sha256").update(token).digest("hex");

function tokenFrom(req: IncomingMessage): string | null {
  for (const pair of (req.headers.cookie ?? "").split(";")) {
    const [name, ...value] = pair.trim().split("=");
    if (name === COOKIE) return value.join("=") || null;
  }
  return null;
}

export const USER_COLUMNS = "u.id, u.name, u.email, u.role, u.org_id";

export async function sessionUser(req: IncomingMessage): Promise<User | null> {
  const token = tokenFrom(req);
  if (!token) return null;
  const user = await one<User>(
    pool,
    `SELECT ${USER_COLUMNS} FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hash(token)],
  );
  return user ?? null;
}

/** Starts a session and returns its Set-Cookie header. */
export async function startSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))", [
    hash(token),
    userId,
    LIFETIME_S,
  ]);
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${LIFETIME_S}`;
}

/** Ends the request's session and returns the clearing Set-Cookie header. */
export async function endSession(req: IncomingMessage): Promise<string> {
  const token = tokenFrom(req);
  if (token) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [hash(token)]);
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
