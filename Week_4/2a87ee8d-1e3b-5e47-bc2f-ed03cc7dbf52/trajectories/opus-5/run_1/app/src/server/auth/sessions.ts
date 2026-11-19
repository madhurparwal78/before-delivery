import { pool } from '../db/pool.js';
import { AppError } from '../errors.js';
import { newSessionToken } from '../ids.js';
import type { RequestContext } from '../http/context.js';
import { config } from '../config.js';

export const FACILITATOR_COOKIE = 'lf_facilitator';
export const PARTICIPANT_COOKIE_PREFIX = 'lf_participant_';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function participantCookieName(workshopId: string): string {
  return `${PARTICIPANT_COOKIE_PREFIX}${workshopId}`;
}

export interface FacilitatorActor {
  readonly kind: 'facilitator';
  readonly facilitatorId: string;
  readonly email: string;
  readonly name: string;
  readonly timeZone: string;
}

export interface ParticipantActor {
  readonly kind: 'participant';
  readonly participantId: string;
  readonly workshopId: string;
  readonly facilitatorId: string;
  readonly displayName: string;
  readonly cursorId: string;
  readonly hue: number;
}

export type Actor = FacilitatorActor | ParticipantActor;

export function actorKey(actor: Actor): string {
  return actor.kind === 'facilitator'
    ? `facilitator:${actor.facilitatorId}`
    : `participant:${actor.participantId}`;
}

export async function createFacilitatorSession(context: RequestContext, facilitatorId: string): Promise<void> {
  const token = newSessionToken();
  await pool.query(`INSERT INTO sessions (token, kind, facilitator_id) VALUES ($1, 'facilitator', $2)`, [
    token,
    facilitatorId,
  ]);
  context.addCookie(FACILITATOR_COOKIE, token, SESSION_MAX_AGE_SECONDS);
}

export async function createParticipantSession(
  context: RequestContext,
  participantId: string,
  workshopId: string,
): Promise<void> {
  const token = newSessionToken();
  await pool.query(
    `INSERT INTO sessions (token, kind, participant_id, workshop_id) VALUES ($1, 'participant', $2, $3)`,
    [token, participantId, workshopId],
  );
  context.addCookie(participantCookieName(workshopId), token, SESSION_MAX_AGE_SECONDS);
}

export async function destroyFacilitatorSession(context: RequestContext): Promise<void> {
  const token = context.cookies[FACILITATOR_COOKIE];
  if (token !== undefined) await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
  context.clearCookie(FACILITATOR_COOKIE);
}

export async function readFacilitatorActor(context: RequestContext): Promise<FacilitatorActor | null> {
  const token = context.cookies[FACILITATOR_COOKIE];
  if (token === undefined) return null;
  const result = await pool.query<{ id: string; email: string; name: string; time_zone: string }>(
    `SELECT f.id, f.email, f.name, f.time_zone
       FROM sessions s JOIN facilitators f ON f.id = s.facilitator_id
      WHERE s.token = $1 AND s.kind = 'facilitator'`,
    [token],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    kind: 'facilitator',
    facilitatorId: row.id,
    email: row.email,
    name: row.name,
    timeZone: row.time_zone,
  };
}

interface ParticipantSessionRow {
  participant_id: string;
  workshop_id: string;
  facilitator_id: string;
  display_name: string;
  cursor_id: string;
  hue: number;
  revoked_at: Date | null;
  end_at: Date;
}

export interface ParticipantSessionState {
  readonly actor: ParticipantActor;
  /** A session whose join link is revoked or expired has ended. */
  readonly ended: boolean;
}

/**
 * Session validity is read from Postgres on every request: a session is bound to the link
 * it joined through, and ends once that link is revoked or expired.
 */
async function readParticipantSessions(context: RequestContext): Promise<ParticipantSessionState[]> {
  const tokens: string[] = [];
  for (const [name, value] of Object.entries(context.cookies)) {
    if (name.startsWith(PARTICIPANT_COOKIE_PREFIX)) tokens.push(value);
  }
  if (tokens.length === 0) return [];
  const result = await pool.query<ParticipantSessionRow>(
    `SELECT p.id AS participant_id, p.workshop_id, w.facilitator_id, p.display_name, p.cursor_id, p.hue,
            jl.revoked_at, w.end_at
       FROM sessions s
       JOIN participants p ON p.id = s.participant_id
       JOIN join_links jl ON jl.id = p.join_link_id
       JOIN workshops w ON w.id = p.workshop_id
      WHERE s.token = ANY($1::text[]) AND s.kind = 'participant'`,
    [tokens],
  );
  const expiryMs = config.joinLinkGraceSeconds * 1000;
  return result.rows.map((row) => ({
    actor: {
      kind: 'participant',
      participantId: row.participant_id,
      workshopId: row.workshop_id,
      facilitatorId: row.facilitator_id,
      displayName: row.display_name,
      cursorId: row.cursor_id,
      hue: row.hue,
    },
    ended: row.revoked_at !== null || context.nowMs >= row.end_at.getTime() + expiryMs,
  }));
}

export interface CallerLookup {
  readonly facilitator: FacilitatorActor | null;
  readonly participantSessions: readonly ParticipantSessionState[];
}

export async function lookupCaller(context: RequestContext): Promise<CallerLookup> {
  const [facilitator, participantSessions] = await Promise.all([
    readFacilitatorActor(context),
    readParticipantSessions(context),
  ]);
  return { facilitator, participantSessions };
}

/**
 * Picks the acting caller. A facilitator session acts as that facilitator; otherwise any
 * valid participant session authenticates the request, preferring the session that belongs
 * to the request's workshop.
 *
 * 401 is reserved for requests carrying no valid session at all. The code is `session_ended`
 * when the request carries at least one participant session that has ended.
 */
export function resolveActor(lookup: CallerLookup, workshopId: string | null): Actor {
  if (lookup.facilitator) return lookup.facilitator;
  const live = lookup.participantSessions.filter((session) => !session.ended);
  if (workshopId !== null) {
    const forWorkshop = live.find((session) => session.actor.workshopId === workshopId);
    if (forWorkshop) return forWorkshop.actor;
    const endedForWorkshop = lookup.participantSessions.find(
      (session) => session.actor.workshopId === workshopId && session.ended,
    );
    if (endedForWorkshop) throw new AppError('session_ended');
  }
  const anyLive = live[0];
  if (anyLive) return anyLive.actor;
  if (lookup.participantSessions.some((session) => session.ended)) throw new AppError('session_ended');
  throw new AppError('unauthenticated');
}

export function requireFacilitator(actor: Actor): FacilitatorActor {
  if (actor.kind !== 'facilitator') throw new AppError('forbidden');
  return actor;
}
