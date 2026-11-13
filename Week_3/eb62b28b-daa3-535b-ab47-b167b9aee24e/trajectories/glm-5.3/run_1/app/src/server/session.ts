import type { Request } from "express";
import type { Database } from "./db.js";
import { newId } from "./crypto.js";
import type { Role } from "../shared/enums.js";
import { ApiError } from "./errors.js";

export const SESSION_COOKIE = "ocotillo_session";

export type Person = {
  kind: "staff" | "member";
  id: string;
  name: string;
  role: Role;
};

export type SessionRow = {
  id: string;
  person_kind: string;
  person_id: string;
  role: string;
  expires_at: Date;
  ended_at: Date | null;
};

export function cookieOptions(): { httpOnly: true; sameSite: "lax"; path: string } {
  return { httpOnly: true, sameSite: "lax", path: "/" };
}

export function setSessionCookie(res: import("express").Response, sessionId: string): void {
  res.cookie(SESSION_COOKIE, sessionId, cookieOptions());
}

export function clearSessionCookie(res: import("express").Response): void {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

export function readSessionCookie(req: Request): string | null {
  const cookies = req.cookies as Record<string, string> | undefined;
  const value = cookies?.[SESSION_COOKIE];
  return value && value.length > 0 ? value : null;
}

/** Load the session and its person; the server alone decides a session has ended. */
export async function requireSession(
  db: Database,
  req: Request,
  sessionSeconds: number
): Promise<Person> {
  const token = readSessionCookie(req);
  if (!token) throw new ApiError(401, "not_signed_in", "Sign in to continue.");
  const row = await db.one<{
    id: string;
    person_kind: string;
    person_id: string;
    role: string;
    expires_at: Date;
    ended_at: Date | null;
  }>(
    `SELECT s.id, s.person_kind, s.person_id, s.role, s.expires_at, s.ended_at
     FROM sessions s
     WHERE s.id = $1`,
    [token]
  );
  if (!row) throw new ApiError(401, "not_signed_in", "Sign in to continue.");
  if (row.ended_at) throw new ApiError(401, "session_ended", sessionEndedCopy);
  if (row.expires_at.getTime() <= Date.now()) throw new ApiError(401, "session_ended", sessionEndedCopy);
  if (row.person_kind === "staff") {
    const staff = await db.one<{ id: string; name: string; role: string; removed_at: Date | null }>(
      `SELECT id, name, role, removed_at FROM staff WHERE id = $1`,
      [row.person_id]
    );
    if (!staff || staff.removed_at) throw new ApiError(401, "session_ended", sessionEndedCopy);
    return { kind: "staff", id: staff.id, name: staff.name, role: staff.role as Role };
  }
  const member = await db.one<{ id: string; name: string; account_state: string }>(
    `SELECT id, name, account_state FROM members WHERE id = $1`,
    [row.person_id]
  );
  if (!member || member.account_state === "erased") {
    throw new ApiError(401, "session_ended", sessionEndedCopy);
  }
  return { kind: "member", id: member.id, name: member.name, role: "member" };
}

export const sessionEndedCopy = "Your session ended. Sign in again to keep going — what you typed is still here.";

export async function createSession(
  db: Database,
  person: Person,
  sessionSeconds: number
): Promise<string> {
  const id = newId("sess");
  const expires = new Date(Date.now() + sessionSeconds * 1000);
  await db.exec(
    `INSERT INTO sessions (id, person_kind, person_id, role, expires_at) VALUES ($1, $2, $3, $4, $5)`,
    [id, person.kind, person.id, person.role, expires]
  );
  return id;
}

export async function endSession(db: Database, sessionId: string): Promise<void> {
  await db.exec(`UPDATE sessions SET ended_at = now() WHERE id = $1`, [sessionId]);
}

export async function endSessionsFor(db: Database, personKind: string, personId: string, exceptSessionId?: string): Promise<void> {
  if (exceptSessionId) {
    await db.exec(
      `UPDATE sessions SET ended_at = now() WHERE person_kind = $1 AND person_id = $2 AND ended_at IS NULL AND id <> $3`,
      [personKind, personId, exceptSessionId]
    );
  } else {
    await db.exec(
      `UPDATE sessions SET ended_at = now() WHERE person_kind = $1 AND person_id = $2 AND ended_at IS NULL`,
      [personKind, personId]
    );
  }
}
