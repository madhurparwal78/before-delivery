import type { IncomingMessage } from "node:http";
import { randomBytes } from "node:crypto";
import { config, secureCookies, sessionCookieName } from "./config.ts";
import { one, type Db } from "./db.ts";
import { sha256 } from "./hash.ts";
import { ApiError } from "./http.ts";

export interface User {
  id: string;
  email: string;
  displayName: string;
}

export interface Session {
  idHash: string;
  csrfToken: string;
  user: User;
}

function readSessionCookie(req: IncomingMessage): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === sessionCookieName) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

export type SessionState = { kind: "none" } | { kind: "expired" } | { kind: "active"; session: Session };

interface SessionRow {
  id_hash: string;
  csrf_token: string;
  created_at: Date;
  last_seen_at: Date;
  user_id: string;
  email: string;
  display_name: string;
}

/** Resolves the request's session. An active session's idle clock is reset when `touch` is set. */
export async function resolveSession(db: Db, req: IncomingMessage, touch: boolean): Promise<SessionState> {
  const raw = readSessionCookie(req);
  if (!raw) return { kind: "none" };
  const row = await one<SessionRow>(
    db,
    `SELECT s.id_hash, s.csrf_token, s.created_at, s.last_seen_at, u.id AS user_id, u.email, u.display_name
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = $1`,
    [sha256(raw)],
  );
  if (!row) return { kind: "none" };
  const now = Date.now();
  if (now - row.last_seen_at.getTime() > config.timers.sessionIdle * 1000 || now - row.created_at.getTime() > config.timers.sessionAbsolute * 1000) {
    return { kind: "expired" };
  }
  if (touch) await db.query("UPDATE sessions SET last_seen_at = now() WHERE id_hash = $1", [row.id_hash]);
  return {
    kind: "active",
    session: { idHash: row.id_hash, csrfToken: row.csrf_token, user: { id: row.user_id, email: row.email, displayName: row.display_name } },
  };
}

export function requireSession(state: SessionState): Session {
  if (state.kind === "active") return state.session;
  if (state.kind === "expired") throw new ApiError(401, "session_expired", "Your session has ended. Sign in again.");
  throw new ApiError(401, "unauthenticated", "Sign in to continue.");
}

interface IssuedSession {
  cookie: string;
  csrfToken: string;
}

/** Creates a new session for `userId`, deleting any session carried by the request's own cookie. */
export async function issueSession(db: Db, req: IncomingMessage, userId: string): Promise<IssuedSession> {
  const carried = readSessionCookie(req);
  if (carried) await db.query("DELETE FROM sessions WHERE id_hash = $1", [sha256(carried)]);
  const id = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(32).toString("base64url");
  await db.query(
    "INSERT INTO sessions (id_hash, user_id, csrf_token, created_at, last_seen_at) VALUES ($1, $2, $3, now(), now())",
    [sha256(id), userId, csrfToken],
  );
  return { cookie: sessionCookie(id), csrfToken };
}

export async function endAllSessions(db: Db, userId: string): Promise<void> {
  await db.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
}

function sessionCookie(value: string): string {
  return `${sessionCookieName}=${value}; HttpOnly;${secureCookies ? " Secure;" : ""} SameSite=Lax; Path=/`;
}

export const clearedCookie = () => `${sessionCookieName}=; HttpOnly;${secureCookies ? " Secure;" : ""} SameSite=Lax; Path=/; Max-Age=0`;

export function sessionBody(user: User, csrfToken: string) {
  return { user: { id: user.id, email: user.email, displayName: user.displayName }, csrfToken };
}
