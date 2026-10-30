import { many, one, type Queryable } from '../db/pool.js';
import {
  datesBetween,
  festivalDayEnd,
  festivalDayLabel,
  festivalDayOf,
  festivalDayStart,
  toLocalIso,
  toUtcIso,
} from '../lib/time.js';
import { liveHold, liveOffer, seatHoldingStatesSql } from './liveness.js';
import type { ProgrammeState } from './states.js';

export interface SessionRow {
  id: string;
  title: string;
  description: string;
  discipline: string;
  venue_id: string;
  admission: 'pass' | 'seat';
  capacity: number | null;
  price_full_cents: number | null;
  price_reduced_cents: number | null;
  starts_at: Date;
  ends_at: Date;
  status: ProgrammeState;
  effective_status: ProgrammeState;
  publish_at: Date | null;
  version: number;
  seats_remaining: number | null;
}

/**
 * A scheduled item counts as published from its publishing instant on, so every read derives the
 * status rather than waiting for the background pass.
 */
const EFFECTIVE_STATUS = `
  CASE WHEN s.status = 'scheduled' AND s.publish_at IS NOT NULL AND s.publish_at <= now()
       THEN 'published' ELSE s.status END`;

/**
 * Seats remaining is capacity minus active holds, open waitlist offers and seats on pending, sold
 * or transferred lines. It is computed from those records on every read.
 */
const SEATS_REMAINING = `
  CASE WHEN s.capacity IS NULL THEN NULL ELSE GREATEST(0, s.capacity
    - COALESCE((SELECT SUM(h.quantity) FROM holds h
        WHERE h.session_id = s.id AND ${liveHold('h')}), 0)
    - COALESCE((SELECT COUNT(*) FROM waitlist_entries w
        WHERE w.session_id = s.id AND ${liveOffer('w')}), 0)
    - COALESCE((SELECT COUNT(*) FROM order_lines l
        WHERE l.session_id = s.id AND l.state IN (${seatHoldingStatesSql()})), 0)
  ) END`;

const SESSION_COLUMNS = `
  s.id, s.title, s.description, s.discipline, s.venue_id, s.admission, s.capacity,
  s.price_full_cents, s.price_reduced_cents, s.starts_at, s.ends_at, s.status, s.publish_at,
  s.version, ${EFFECTIVE_STATUS} AS effective_status, ${SEATS_REMAINING} AS seats_remaining`;

export async function loadSession(db: Queryable, id: string): Promise<SessionRow | null> {
  return one<SessionRow>(
    db,
    `SELECT ${SESSION_COLUMNS} FROM programme_sessions s WHERE s.id = $1`,
    [id],
  );
}

export async function loadSessionForUpdate(
  db: Queryable,
  id: string,
): Promise<SessionRow | null> {
  const locked = await one<{ id: string }>(
    db,
    `SELECT id FROM programme_sessions WHERE id = $1 FOR UPDATE`,
    [id],
  );
  if (locked === null) return null;
  return loadSession(db, id);
}

export async function listSessions(
  db: Queryable,
  options: { statuses?: readonly string[] } = {},
): Promise<SessionRow[]> {
  if (options.statuses === undefined) {
    return many<SessionRow>(
      db,
      `SELECT ${SESSION_COLUMNS} FROM programme_sessions s ORDER BY s.starts_at, s.id`,
    );
  }
  return many<SessionRow>(
    db,
    `SELECT * FROM (SELECT ${SESSION_COLUMNS} FROM programme_sessions s) AS t
     WHERE t.effective_status = ANY($1::text[]) ORDER BY t.starts_at, t.id`,
    [[...options.statuses]],
  );
}

export async function seatsRemaining(db: Queryable, sessionId: string): Promise<number | null> {
  const row = await one<{ seats_remaining: number | null }>(
    db,
    `SELECT ${SEATS_REMAINING} AS seats_remaining FROM programme_sessions s WHERE s.id = $1`,
    [sessionId],
  );
  return row?.seats_remaining ?? null;
}

export interface SerialisedSession {
  id: string;
  title: string;
  description: string;
  discipline: string;
  venue_id: string;
  admission: 'pass' | 'seat';
  capacity: number | null;
  seats_remaining: number | null;
  price_full_cents: number | null;
  price_reduced_cents: number | null;
  starts_at: string;
  ends_at: string;
  starts_local: string;
  ends_local: string;
  festival_day: string;
  status: ProgrammeState;
  publish_at?: string | null;
  version?: number;
}

export function serialiseSession(row: SessionRow, full: boolean): SerialisedSession {
  const base: SerialisedSession = {
    id: row.id,
    title: row.title,
    description: row.description,
    discipline: row.discipline,
    venue_id: row.venue_id,
    admission: row.admission,
    capacity: row.capacity,
    seats_remaining: row.admission === 'seat' ? row.seats_remaining : null,
    price_full_cents: row.price_full_cents,
    price_reduced_cents: row.price_reduced_cents,
    starts_at: toUtcIso(row.starts_at),
    ends_at: toUtcIso(row.ends_at),
    starts_local: toLocalIso(row.starts_at),
    ends_local: toLocalIso(row.ends_at),
    festival_day: festivalDayOf(row.starts_at),
    status: row.effective_status,
  };
  if (full) {
    base.publish_at = row.publish_at === null ? null : toUtcIso(row.publish_at);
    base.version = row.version;
  }
  return base;
}

export interface Edition {
  name: string;
  first_day: string;
  last_day: string;
}

export async function loadEdition(db: Queryable): Promise<Edition> {
  const row = await one<{ name: string; first_day: string; last_day: string }>(
    db,
    `SELECT name, first_day::text AS first_day, last_day::text AS last_day FROM edition WHERE id = 1`,
  );
  if (row === null) throw new Error('edition missing');
  return row;
}

export interface FestivalDay {
  date: string;
  label: string;
  starts_at: string;
  ends_at: string;
}

export function festivalDays(edition: Edition): FestivalDay[] {
  return datesBetween(edition.first_day, edition.last_day).map((date) => ({
    date,
    label: festivalDayLabel(date),
    starts_at: toUtcIso(festivalDayStart(date)),
    ends_at: toUtcIso(festivalDayEnd(date)),
  }));
}

export async function loadVenues(db: Queryable): Promise<Array<{ id: string; name: string }>> {
  return many<{ id: string; name: string }>(
    db,
    `SELECT id, name FROM venues ORDER BY position, id`,
  );
}

export async function loadDisciplines(
  db: Queryable,
): Promise<Array<{ id: string; name: string }>> {
  return many<{ id: string; name: string }>(
    db,
    `SELECT id, name FROM disciplines ORDER BY position, id`,
  );
}

export interface PricePolicy {
  full_festival_full_cents: number;
  full_festival_reduced_cents: number;
  day_full_cents: number;
  day_reduced_cents: number;
  group_discount_percent: number;
  version: number;
}

export async function loadPricePolicy(db: Queryable): Promise<PricePolicy> {
  const row = await one<PricePolicy>(
    db,
    `SELECT full_festival_full_cents, full_festival_reduced_cents, day_full_cents,
            day_reduced_cents, group_discount_percent, version
     FROM price_policy WHERE id = 1`,
  );
  if (row === null) throw new Error('price policy missing');
  return row;
}
