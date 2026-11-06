/**
 * The two API versions' response shapes, spelled out field by field. No v1
 * body is produced by spreading a v2 object, and no v2 body by spreading a v1
 * object. Key order is exactly the published order.
 */

import type { SessionData, SpeakerData, ContestData, OrganiserRow, RosterRow, Seats } from '../agenda.js';
import type { Account } from '../accounts.js';

/** Serialize an ordered object without reordering keys. */
export function json(pairs: Array<[string, unknown]>): string {
  const parts: string[] = [];
  for (const [k, v] of pairs) parts.push(`${JSON.stringify(k)}:${value(v)}`);
  return `{${parts.join(',')}}`;
}

function value(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return `[${v.map(value).join(',')}]`;
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return JSON.stringify(v);
  if (v instanceof Ordered) return v.body;
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    // Fallback: JSON.stringify preserves insertion order.
    return JSON.stringify(obj);
  }
  return JSON.stringify(v);
}

/** A pre-serialized JSON fragment with a known key order. */
export class Ordered {
  constructor(public body: string) {}
}

export function ordered(pairs: Array<[string, unknown]>): Ordered {
  return new Ordered(json(pairs));
}

/* ------------------------------------------------------------------ *
 * Shared value formatting                                             *
 * ------------------------------------------------------------------ */

function iso(at: Date): string {
  return at.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Venue wall-clock HH:MM. */
function hhmm(local: string): string {
  return local;
}

/* ------------------------------------------------------------------ *
 * v1 objects                                                          *
 * ------------------------------------------------------------------ */

export function v1Account(a: Account): Ordered {
  return ordered([
    ['id', a.id],
    ['name', a.name],
    ['email', a.email],
    ['role', a.role],
  ]);
}

export function v1Auth(token: string, account: Account): Ordered {
  return ordered([
    ['token', token],
    ['account', v1Account(account)],
  ]);
}

export function v1Seats(session: SessionData): { capacity: number | null; seatsLeft: number | null } {
  if (session.seats === null) return { capacity: null, seatsLeft: null };
  return { capacity: session.seats.capacity, seatsLeft: session.seats.left };
}

export function v1Session(s: SessionData): Ordered {
  const { capacity, seatsLeft } = v1Seats(s);
  return ordered([
    ['id', s.id],
    ['day', s.day],
    ['date', s.date],
    ['starts_at', hhmm(s.startLocal)],
    ['ends_at', hhmm(s.endLocal)],
    ['starts_at_utc', iso(s.startInstant)],
    ['ends_at_utc', iso(s.endInstant)],
    ['title', s.title],
    ['speakers', s.speakers.map((sp) => ordered([['name', sp.name], ['company', sp.company]]))],
    ['stage', s.stage],
    ['stage_name', s.stageName],
    ['location', s.location],
    ['format', s.format],
    ['format_label', s.formatLabel],
    ['description', s.description],
    ['capacity', capacity],
    ['seats_left', seatsLeft],
    ['waitlist_count', s.waitlistCount],
    ['reserved_by_me', s.reservedByMe],
    ['saved_by_me', s.savedByMe],
    ['waitlist_position', s.waitlistPosition],
  ]);
}

export function v1Speaker(sp: SpeakerData): Ordered {
  return ordered([
    ['name', sp.name],
    ['company', sp.company],
    ['sessions', sp.sessions],
  ]);
}

export function v1Reservation(r: { id: number; sessionId: string; createdAt: Date }): Ordered {
  return ordered([
    ['id', r.id],
    ['session_id', r.sessionId],
    ['created_at', iso(r.createdAt)],
  ]);
}

export function v1ReservationCreated(r: { id: number; sessionId: string; createdAt: Date }, seatsLeft: number): Ordered {
  return ordered([
    ['reservation', v1Reservation(r)],
    ['seats_left', seatsLeft],
  ]);
}

export function v1Cancelled(seatsLeft: number): Ordered {
  return ordered([['seats_left', seatsLeft]]);
}

export function v1Waitlist(sessionId: string, position: number, createdAt: Date): Ordered {
  return ordered([
    ['session_id', sessionId],
    ['position', position],
    ['created_at', iso(createdAt)],
  ]);
}

export function v1MyAgenda(a: { reserved: SessionData[]; waitlisted: SessionData[]; saved: SessionData[] }): Ordered {
  return ordered([
    ['reserved', a.reserved.map(v1Session)],
    ['waitlisted', a.waitlisted.map(v1Session)],
    ['saved', a.saved.map(v1Session)],
  ]);
}

export function v1OrganiserRow(r: OrganiserRow): Ordered {
  return ordered([
    ['id', r.id],
    ['title', r.title],
    ['day', r.day],
    ['starts_at', hhmm(r.startLocal)],
    ['ends_at', hhmm(r.endLocal)],
    ['capacity', r.seats === null ? null : r.seats.capacity],
    ['reserved', r.seats === null ? null : r.seats.reserved + r.seats.held],
    ['seats_left', r.seats === null ? null : r.seats.left],
    ['waitlisted', r.waitlisted],
  ]);
}

export function v1RosterRow(r: RosterRow): Ordered {
  return ordered([
    ['name', r.name],
    ['email', r.email],
    ['reserved_at', iso(r.reservedAt)],
  ]);
}

export function v1Guess(value: number, createdAt: Date): Ordered {
  return ordered([
    ['value', value],
    ['created_at', iso(createdAt)],
  ]);
}

export function v1Record(c: ContestData): Ordered {
  return ordered([
    ['status', c.status],
    ['closes_at', iso(c.closesAt)],
    ['guess_count', c.guessCount],
    [
      'my_guess',
      c.myGuess === null ? null : v1Guess(c.myGuess.value, c.myGuess.createdAt),
    ],
    ['final_figure', c.finalFigure],
    ['revealed_at', c.revealedAt === null ? null : iso(c.revealedAt)],
    ['leaderboard', c.leaderboard.map((l) => leader(l))],
  ]);
}

export function v1Reveal(c: ContestData): Ordered {
  return ordered([
    ['status', c.status],
    ['final_figure', c.finalFigure],
    ['revealed_at', c.revealedAt === null ? null : iso(c.revealedAt)],
    ['leaderboard', c.leaderboard.map((l) => leader(l))],
  ]);
}

function leader(l: { rank: number; displayName: string; value: number; distance: number }): Ordered {
  return ordered([
    ['rank', l.rank],
    ['display_name', l.displayName],
    ['value', l.value],
    ['distance', l.distance],
  ]);
}

/* ------------------------------------------------------------------ *
 * v2 objects                                                          *
 * ------------------------------------------------------------------ */

export function v2Seats(seats: Seats): Ordered {
  return ordered([
    ['capacity', seats.capacity],
    ['reserved', seats.reserved],
    ['held', seats.held],
    ['left', seats.left],
  ]);
}

export function v2Account(a: Account): Ordered {
  return ordered([
    ['id', a.id],
    ['name', a.name],
    ['email', a.email],
    ['role', a.role],
  ]);
}

export function v2Auth(token: string, account: Account): Ordered {
  return ordered([
    ['token', token],
    ['account', v2Account(account)],
  ]);
}

export function v2Session(s: SessionData): Ordered {
  return ordered([
    ['id', s.id],
    ['day', s.day],
    ['date', s.date],
    ['start_local', s.startLocal],
    ['end_local', s.endLocal],
    ['start_instant', iso(s.startInstant)],
    ['end_instant', iso(s.endInstant)],
    ['title', s.title],
    ['speakers', s.speakers.map((sp) => ordered([['name', sp.name], ['company', sp.company]]))],
    ['stage', s.stage],
    ['stage_name', s.stageName],
    ['location', s.location],
    ['format', s.format],
    ['format_label', s.formatLabel],
    ['description', s.description],
    ['seats', s.seats === null ? null : v2Seats(s.seats)],
    ['waitlist_count', s.waitlistCount],
    ['reserved_by_me', s.reservedByMe],
    ['saved_by_me', s.savedByMe],
    ['waitlist_position', s.waitlistPosition],
    [
      'my_hold',
      s.myHold === null
        ? null
        : ordered([
            ['session_id', s.myHold.sessionId],
            ['held_until', iso(s.myHold.heldUntil)],
            ['seconds_remaining', s.myHold.secondsRemaining],
          ]),
    ],
  ]);
}

export function v2Speaker(sp: SpeakerData): Ordered {
  return ordered([
    ['slug', sp.slug],
    ['name', sp.name],
    ['company', sp.company],
    ['sessions', sp.sessions],
    ['bio', sp.bio],
    ['bio_html', sp.bioHtml],
  ]);
}

export function v2Reservation(r: { id: number; sessionId: string; createdAt: Date }): Ordered {
  return ordered([
    ['id', r.id],
    ['session_id', r.sessionId],
    ['created_at', iso(r.createdAt)],
  ]);
}

export function v2ReservationCreated(r: { id: number; sessionId: string; createdAt: Date }, seats: Seats): Ordered {
  return ordered([
    ['reservation', v2Reservation(r)],
    ['seats', v2Seats(seats)],
  ]);
}

export function v2Cancelled(seats: Seats): Ordered {
  return ordered([['seats', v2Seats(seats)]]);
}

export function v2MyAgenda(a: {
  reserved: SessionData[];
  held: SessionData[];
  waitlisted: SessionData[];
  saved: SessionData[];
}): Ordered {
  return ordered([
    ['reserved', a.reserved.map(v2Session)],
    ['held', a.held.map(v2Session)],
    ['waitlisted', a.waitlisted.map(v2Session)],
    ['saved', a.saved.map(v2Session)],
  ]);
}

export function v2Hold(h: { sessionId: string; heldUntil: Date; secondsRemaining: number }): Ordered {
  return ordered([
    ['session_id', h.sessionId],
    ['held_until', iso(h.heldUntil)],
    ['seconds_remaining', h.secondsRemaining],
  ]);
}

export function v2OrganiserRow(r: OrganiserRow): Ordered {
  return ordered([
    ['id', r.id],
    ['title', r.title],
    ['day', r.day],
    ['start_local', r.startLocal],
    ['end_local', r.endLocal],
    ['seats', r.seats === null ? null : v2Seats(r.seats)],
    ['waitlisted', r.waitlisted],
  ]);
}

export function v2RosterRow(r: RosterRow): Ordered {
  return ordered([
    ['name', r.name],
    ['email', r.email],
    ['reserved_at', iso(r.reservedAt)],
  ]);
}

export function v2Guess(value: number, createdAt: Date): Ordered {
  return ordered([
    ['value', value],
    ['created_at', iso(createdAt)],
  ]);
}

export function v2Record(c: ContestData): Ordered {
  return ordered([
    ['status', c.status],
    ['closes_at', iso(c.closesAt)],
    ['guess_count', c.guessCount],
    ['my_guess', c.myGuess === null ? null : v2Guess(c.myGuess.value, c.myGuess.createdAt)],
    ['final_figure', c.finalFigure],
    ['revealed_at', c.revealedAt === null ? null : iso(c.revealedAt)],
    ['leaderboard', c.leaderboard.map((l) => leader(l))],
  ]);
}

export function v2Reveal(c: ContestData): Ordered {
  return ordered([
    ['status', c.status],
    ['final_figure', c.finalFigure],
    ['revealed_at', c.revealedAt === null ? null : iso(c.revealedAt)],
    ['leaderboard', c.leaderboard.map((l) => leader(l))],
  ]);
}

export function v2SpeakerObj(sp: SpeakerData): Ordered {
  return v2Speaker(sp);
}
