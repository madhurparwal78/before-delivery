// Cookie sessions stored in PostgreSQL. An offboarded tenant's sessions stop working at once.
import type { IncomingMessage } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import type { Role } from "../shared/kitchen";
import { one, pool } from "./db";

const SESSION_COOKIE = "sk_session";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  tenant_id: string | null;
}

const tokenHash = (token: string): string => createHash("sha256").update(token).digest("hex");

function sessionToken(req: IncomingMessage): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) return value.join("=");
  }
  return null;
}

export async function sessionUser(req: IncomingMessage): Promise<SessionUser | null> {
  const token = sessionToken(req);
  if (!token) return null;
  const user = await one<SessionUser>(
    pool,
    `SELECT u.id, u.name, u.email, u.role, u.tenant_id
       FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE s.token_hash = $1 AND (t.id IS NULL OR t.lifecycle <> 'offboarded')`,
    [tokenHash(token)],
  );
  return user ?? null;
}

/** Starts a session and returns its Set-Cookie value. */
export async function startSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)", [tokenHash(token), userId]);
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export async function endSession(req: IncomingMessage): Promise<string> {
  const token = sessionToken(req);
  if (token) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
