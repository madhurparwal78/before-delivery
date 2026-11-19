import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { query } from "../db/pool.ts";

const COOKIE = "semenza_session";

export interface Session {
  id: string;
  deskId: string;
  name: string;
  email: string;
}

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function cookieToken(req: IncomingMessage): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [name, value] = part.trim().split("=");
    if (name === COOKIE && value) return value;
  }
  return null;
}

/** `ended` means a cookie came that no longer opens a session. */
export async function readSession(req: IncomingMessage): Promise<{ live: Session | null; ended: boolean }> {
  const token = cookieToken(req);
  if (!token) return { live: null, ended: false };
  const rows = await query<Session>(
    `SELECT s.id, s.desk_id AS "deskId", d.name, d.email FROM sessions s JOIN desks d ON d.id = s.desk_id
     WHERE s.id = $1 AND s.ended_at IS NULL AND s.ends_at > now()`,
    [hash(token)],
  );
  return { live: rows[0] ?? null, ended: rows.length === 0 };
}

/** The session cookie: HttpOnly, SameSite=Lax, never Secure, and a browser-session cookie. */
export function sessionCookie(token: string): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearedCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax`;
}

export async function startSession(deskId: string, lifetimeSeconds: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await query(`INSERT INTO sessions (id, desk_id, ends_at) VALUES ($1, $2, now() + make_interval(secs => $3))`, [hash(token), deskId, lifetimeSeconds]);
  return token;
}
