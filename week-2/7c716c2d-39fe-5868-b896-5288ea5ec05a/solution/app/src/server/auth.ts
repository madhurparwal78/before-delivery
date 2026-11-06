// Sessions: an opaque HttpOnly cookie whose hash is stored in Postgres. Every authenticated
// request also counts as presence activity.
import type { IncomingMessage } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import type { PersonRow } from "./access.js";
import { one, query, type Db } from "./db.js";
import { nowMs } from "./time.js";
import { markActive } from "./presence.js";

const COOKIE = "tr_session";

export type SessionPerson = PersonRow;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function readCookie(req: IncomingMessage): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return rest.join("=") || null;
  }
  return null;
}

/** The session's person, whose request is marked as presence activity. */
export async function authenticate(req: IncomingMessage): Promise<SessionPerson | null> {
  const token = readCookie(req);
  const person = await one<SessionPerson>(
    `SELECT p.id, p.name, p.email, p.handle, p.role, p.workspace_id, s.token_hash AS session_id FROM sessions s JOIN people p ON p.id = s.person_id WHERE s.token_hash = $1`,
    [hashToken(token ?? "")],
  );
  if (!person) return null;
  if (person.workspace_id) await markActive(person.id, person.workspace_id);
  return person;
}

export async function createSession(db: Db, personId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.query("INSERT INTO sessions (token_hash, person_id, created_at) VALUES ($1, $2, $3)", [hashToken(token), personId, nowMs()]);
  return token;
}

export function sessionCookie(token: string): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearedCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function endSession(req: IncomingMessage): Promise<void> {
  const token = readCookie(req);
  if (token) await query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
}

