import crypto from "node:crypto";
import { config } from "./config.js";
import { db, type Db } from "./db.js";
import { ApiError, fail } from "./errors.js";
import type { Req } from "./http.js";

export interface Facilitator {
  kind: "facilitator";
  id: string;
  name: string;
  email: string;
  timeZone: string;
}

export interface Participant {
  kind: "participant";
  id: string;
  workshopId: string;
  facilitatorId: string;
  displayName: string;
  linkId: string;
  cursorId: string;
  hue: number;
}

export type Actor = Facilitator | Participant;

export function actorKey(actor: Actor): string {
  return `${actor.kind === "facilitator" ? "f" : "p"}:${actor.id}`;
}

export const FACILITATOR_COOKIE = "lf_fac";
const PARTICIPANT_PREFIX = "lf_p_";

export function participantCookieName(workshopId: string): string {
  return `${PARTICIPANT_PREFIX}${workshopId}`;
}

export function cookie(name: string, value: string): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function newToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${crypto.scryptSync(password, salt, 32).toString("hex")}`;
}

export function checkPassword(password: string, stored: string): boolean {
  const [, salt = "", hash = ""] = stored.split("$");
  const actual = crypto.scryptSync(password, Buffer.from(salt, "hex"), 32);
  const expected = Buffer.from(hash, "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}

/**
 * A participant session is active while the join link it came through is neither revoked nor expired.
 * `w` and `l` are the workshop and join-link aliases in the surrounding query.
 */
export const ACTIVE_SESSION_SQL = `(l.revoked_at IS NULL AND now() < w.end_at + make_interval(secs => ${config.joinLinkGraceSeconds}))`;

export function linkExpiresAt(endAt: Date): Date {
  return new Date(endAt.getTime() + config.joinLinkGraceSeconds * 1000);
}

export async function facilitatorFromCookie(req: Req, t: Db = db): Promise<Facilitator | null> {
  const token = req.cookies[FACILITATOR_COOKIE];
  if (!token) return null;
  const row = await t.one<{ id: string; name: string; email: string; time_zone: string }>(
    `SELECT f.id, f.name, f.email, f.time_zone FROM facilitator_sessions s JOIN facilitators f ON f.id = s.facilitator_id
     WHERE s.token_hash = $1`,
    [hashToken(token)],
  );
  return row ? { kind: "facilitator", id: row.id, name: row.name, email: row.email, timeZone: row.time_zone } : null;
}

interface SessionRow {
  id: string;
  workshop_id: string;
  facilitator_id: string;
  display_name: string;
  link_id: string;
  cursor_id: string;
  hue: number;
  active: boolean;
}

export async function participantSessions(req: Req): Promise<{ active: Participant[]; ended: boolean }> {
  const hashes = Object.entries(req.cookies)
    .filter(([name]) => name.startsWith(PARTICIPANT_PREFIX))
    .map(([, token]) => hashToken(token));
  if (hashes.length === 0) return { active: [], ended: false };
  const rows = await db.rows<SessionRow>(
    `SELECT p.id, p.workshop_id, w.facilitator_id, p.display_name, p.link_id, p.cursor_id, p.hue, ${ACTIVE_SESSION_SQL} AS active
     FROM participants p JOIN join_links l ON l.id = p.link_id JOIN workshops w ON w.id = p.workshop_id
     WHERE p.session_hash IN (SELECT jsonb_array_elements_text($1::jsonb))`,
    [hashes],
  );
  return {
    active: rows
      .filter((r) => r.active)
      .map((r) => ({
        kind: "participant",
        id: r.id,
        workshopId: r.workshop_id,
        facilitatorId: r.facilitator_id,
        displayName: r.display_name,
        linkId: r.link_id,
        cursorId: r.cursor_id,
        hue: r.hue,
      })),
    ended: rows.some((r) => !r.active),
  };
}

export interface Caller {
  facilitator: Facilitator | null;
  participants: Participant[];
}

/** Step 2 of the error order: a request with no valid session at all answers 401. */
export async function authenticate(req: Req): Promise<Caller> {
  const facilitator = await facilitatorFromCookie(req);
  if (facilitator) return { facilitator, participants: [] };
  const sessions = await participantSessions(req);
  if (sessions.active.length) return { facilitator: null, participants: sessions.active };
  fail(sessions.ended ? "session_ended" : "unauthenticated");
}

/** The actor for a workshop: its own facilitator, or this browser's participant in it. Anyone else gets 404. */
export function actorFor(caller: Caller, workshop: { id: string; facilitator_id: string }): Actor {
  if (caller.facilitator) {
    if (caller.facilitator.id === workshop.facilitator_id) return caller.facilitator;
    fail("not_found");
  }
  const participant = caller.participants.find((p) => p.workshopId === workshop.id);
  if (!participant) fail("not_found");
  return participant;
}

/** Facilitator-only endpoints with no workshop in the path. */
export function requireFacilitator(caller: Caller): Facilitator {
  if (!caller.facilitator) throw new ApiError("forbidden");
  return caller.facilitator;
}
