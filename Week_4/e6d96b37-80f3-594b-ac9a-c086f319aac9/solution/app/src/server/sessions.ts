// Application sessions: stored in Postgres, aged on the namespace clock, and bound to the
// Keycloak session they came from so every write can confirm the account is still active.

import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { config } from "./config.js";
import { query } from "./db.js";
import { unauthenticated } from "./errors.js";
import { accountActive } from "./keycloak.js";
import { stepUpExpiry, stepUpFresh } from "./rules.js";
import type { Party, Role, SessionInfo } from "../shared/types.js";

export const SESSION_COOKIE = "flan_session";

export interface Session {
  id: string;
  ns: string;
  subject: string;
  username: string;
  role: Role;
  keycloak_session: string | null;
  started_at: Date;
  step_up_at: Date | null;
}

/** The exchange party a session acts as; outsiders never reach a desk route (hidden before transport checks). */
export function partyOf(session: Session): Party {
  return session.role === "counterpart" ? "counterpart" : "dealer";
}

function cookieValue(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

/** The namespace clock for a namespace: its grading clock, otherwise real time. */
async function namespaceNow(ns: string): Promise<Date> {
  const rows = await query<{ clock_at: Date | null }>("SELECT clock_at FROM desks WHERE ns = $1", [ns]);
  return rows[0]?.clock_at ?? new Date();
}

/** The caller's live session, or null when there is none, it ended, or it outlived FLAN_SESSION_TTL_S. */
export async function readSession(req: IncomingMessage): Promise<Session | null> {
  const id = cookieValue(req, SESSION_COOKIE);
  if (!id) {
    await query("SELECT 1");
    return null;
  }
  const rows = await query<Session & { ended: boolean; clock_at: Date | null }>(
    `SELECT s.*, d.clock_at FROM app_sessions s LEFT JOIN desks d ON d.ns = s.ns WHERE s.id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row || row.ended) return null;
  const now = row.clock_at ?? new Date();
  if (now.getTime() - row.started_at.getTime() > config.limits.FLAN_SESSION_TTL_S * 1000) return null;
  return {
    id: row.id,
    ns: row.ns,
    subject: row.subject,
    username: row.username,
    role: row.role,
    keycloak_session: row.keycloak_session,
    started_at: row.started_at,
    step_up_at: row.step_up_at,
  };
}

export async function requireSession(req: IncomingMessage): Promise<Session> {
  const session = await readSession(req);
  if (!session) throw unauthenticated();
  return session;
}

/** Ends every app session of a Keycloak user (revocation, password change, lost Keycloak session). */
export async function endSessionsOf(subject: string): Promise<boolean> {
  const ended = await query("UPDATE app_sessions SET ended = true WHERE subject = $1 AND NOT ended RETURNING id", [subject]);
  return ended.length > 0;
}

/** Writes need an enabled Keycloak account with its session still active. */
export async function requireActiveAccount(session: Session): Promise<void> {
  const active = await accountActive(session.subject, session.keycloak_session ?? "");
  if (!active) {
    await endSessionsOf(session.subject);
    throw unauthenticated();
  }
}

export async function createSession(input: Omit<Session, "id" | "started_at" | "step_up_at">): Promise<string> {
  const id = randomBytes(32).toString("base64url");
  const startedAt = await namespaceNow(input.ns);
  await query(
    `INSERT INTO app_sessions (id, ns, subject, username, role, keycloak_session, started_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, input.ns, input.subject, input.username, input.role, input.keycloak_session, startedAt],
  );
  return id;
}

export function sessionCookie(id: string): string {
  return `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax`;
}

export function sessionInfo(session: Session): SessionInfo {
  return {
    subject: session.subject,
    username: session.username,
    role: session.role,
    namespace: session.ns,
    step_up_fresh: stepUpFresh(session.step_up_at),
    step_up_expires_at: stepUpFresh(session.step_up_at) ? stepUpExpiry(session.step_up_at)!.toISOString() : null,
  };
}
