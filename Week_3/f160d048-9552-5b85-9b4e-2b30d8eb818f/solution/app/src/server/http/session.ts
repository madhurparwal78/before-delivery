import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { first, pool } from "../db/pool";
import type { Viewer } from "../domain/viewer";
import type { Role } from "../../shared/reference";

const SESSION_COOKIE = "cb_session";
const SESSION_SECONDS = 30 * 24 * 60 * 60;

const digest = (token: string): string => createHash("sha256").update(token).digest("hex");

function cookieOf(req: IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

type ViewerRow = {
  id: string; role: Role; display_name: string; email: string; company_id: string | null; company_slug: string | null; unlocked: boolean;
};

const VIEWER_SQL = `SELECT u.id, u.role, u.display_name, u.email, u.company_id, c.slug AS company_slug, u.unlocked
  FROM users u LEFT JOIN companies c ON c.id = u.company_id`;

function toViewer(row: ViewerRow): Viewer {
  return {
    id: row.id,
    role: row.role,
    displayName: row.display_name,
    email: row.email,
    companyId: row.company_id,
    companySlug: row.company_slug,
    unlocked: row.unlocked,
  };
}

export async function viewerOf(req: IncomingMessage): Promise<Viewer | null> {
  const token = cookieOf(req, SESSION_COOKIE);
  if (!token) return null;
  const row = await first<ViewerRow>(
    `${VIEWER_SQL} JOIN sessions s ON s.user_id = u.id WHERE s.token_hash = $1 AND s.expires_at > app_now()`,
    [digest(token)],
  );
  return row ? toViewer(row) : null;
}

type SessionWriter = { query: (sql: string, params: unknown[]) => Promise<unknown> };

export async function openSession(userId: string, db: SessionWriter = pool): Promise<{ token: string; cookie: string }> {
  const token = randomBytes(32).toString("base64url");
  await db.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, app_now() + make_interval(secs => $3))", [
    digest(token),
    userId,
    SESSION_SECONDS,
  ]);
  return { token, cookie: sessionCookie(token, SESSION_SECONDS) };
}

export function sessionCookie(token: string, seconds: number): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${seconds}`;
}

export async function closeSession(req: IncomingMessage): Promise<void> {
  const token = cookieOf(req, SESSION_COOKIE);
  if (token) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [digest(token)]);
}
