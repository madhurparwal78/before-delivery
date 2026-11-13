import { randomUUID } from 'node:crypto';
import { env } from '../env.js';
import { query, withTransaction, type Queryable } from '../db/pool.js';
import { ApiError, ValidationError } from '../http/errors.js';
import { FIELD_ERRORS } from '../../shared/copy.js';
import type { Venue } from '../../shared/seed.js';
import {
  addDays,
  daysBetween,
  endOfDay,
  parseDate,
  startOfDay,
  todayIn,
} from '../../shared/venue-time.js';
import type { CommissionRow, HoldRow } from './commissions.js';

/**
 * Install days are whole venue-local calendar dates with one install each.
 * Holds end at a server instant and are judged on the server on every read.
 */

export const HOLD_WINDOW_MIN_DAYS = 21;
export const HOLD_WINDOW_MAX_DAYS = 365;

export type DayStatus = 'free' | 'held' | 'booked' | 'unavailable' | 'yours';

export interface VenueDay {
  date: string;
  status: DayStatus;
  startsAt: Date;
  endsAt: Date;
}

/** A date can be held from 21 to 365 days after the venue-local date today. */
export function dateIsBookable(venue: Venue, date: string, now = new Date()): boolean {
  const today = todayIn(venue.timeZone, now);
  const offset = daysBetween(today, date);
  return offset >= HOLD_WINDOW_MIN_DAYS && offset <= HOLD_WINDOW_MAX_DAYS;
}

interface SlotRow {
  hold_date: string;
  commission_id: string;
  kind: 'hold' | 'booked';
}

async function slotsBetween(
  venueId: string,
  from: string,
  to: string,
): Promise<Map<string, SlotRow>> {
  const result = await query<SlotRow>(
    `SELECT install_date AS hold_date, commission_id, 'booked' AS kind
       FROM install_days
      WHERE venue_id = $1 AND install_date BETWEEN $2 AND $3
     UNION ALL
     SELECT hold_date, commission_id, 'hold' AS kind
       FROM holds
      WHERE venue_id = $1 AND hold_date BETWEEN $2 AND $3
        AND released_at IS NULL AND booked_at IS NULL AND expires_at > now()`,
    [venueId, from, to],
  );
  const slots = new Map<string, SlotRow>();
  for (const row of result.rows) {
    const existing = slots.get(row.hold_date);
    if (!existing || row.kind === 'booked') slots.set(row.hold_date, row);
  }
  return slots;
}

export async function venueDays(
  venue: Venue,
  from: string,
  to: string,
  commissionId: string | null,
  now = new Date(),
): Promise<VenueDay[]> {
  const slots = await slotsBetween(venue.id, from, to);
  const days: VenueDay[] = [];
  const span = daysBetween(from, to);
  for (let offset = 0; offset <= span; offset += 1) {
    const date = addDays(from, offset);
    const slot = slots.get(date);
    let status: DayStatus;
    if (slot?.kind === 'booked') status = 'booked';
    else if (slot?.kind === 'hold') {
      status = commissionId !== null && slot.commission_id === commissionId ? 'yours' : 'held';
    } else if (!dateIsBookable(venue, date, now)) status = 'unavailable';
    else status = 'free';
    days.push({
      date,
      status,
      startsAt: startOfDay(date, venue.timeZone),
      endsAt: endOfDay(date, venue.timeZone),
    });
  }
  return days;
}

/** The up-to-three earliest free bookable dates after the requested date. */
export async function nextFreeDays(
  venue: Venue,
  afterDate: string,
  limit = 3,
  now = new Date(),
): Promise<string[]> {
  const today = todayIn(venue.timeZone, now);
  const windowEnd = addDays(today, HOLD_WINDOW_MAX_DAYS);
  const earliest = addDays(today, HOLD_WINDOW_MIN_DAYS);
  let from = addDays(afterDate, 1);
  if (daysBetween(from, earliest) > 0) from = earliest;
  if (daysBetween(from, windowEnd) < 0) return [];
  const days = await venueDays(venue, from, windowEnd, null, now);
  return days.filter((d) => d.status === 'free').slice(0, limit).map((d) => d.date);
}

export function validateHoldDate(venue: Venue, date: unknown, now = new Date()): string {
  if (typeof date !== 'string' || !parseDate(date)) {
    throw new ValidationError({ date: FIELD_ERRORS.holdDate });
  }
  if (!dateIsBookable(venue, date, now)) {
    throw new ValidationError({ date: FIELD_ERRORS.holdDate });
  }
  return date;
}

/**
 * Hold a venue day. A lock on the venue date makes exactly one of any number of
 * simultaneous holds succeed; the rest are told the day was taken.
 */
export async function placeHold(
  commission: CommissionRow,
  venue: Venue,
  date: string,
): Promise<HoldRow> {
  return withTransaction(async (tx) => {
    await lockVenueDay(tx, venue.id, date);

    const taken = await tx.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM (
         SELECT 1 FROM install_days WHERE venue_id = $1 AND install_date = $2
         UNION ALL
         SELECT 1 FROM holds
          WHERE venue_id = $1 AND hold_date = $2 AND commission_id <> $3
            AND released_at IS NULL AND booked_at IS NULL AND expires_at > now()
       ) AS slot`,
      [venue.id, date, commission.id],
    );
    if ((taken.rows[0]?.count ?? 0) > 0) {
      const free = await nextFreeDays(venue, date);
      throw new ApiError(409, 'day_taken', 'That day was just taken.', { nextFreeDays: free });
    }

    // A client's new hold on another date releases their previous hold.
    await tx.query(
      `UPDATE holds SET released_at = now()
        WHERE commission_id = $1 AND released_at IS NULL AND booked_at IS NULL`,
      [commission.id],
    );

    const inserted = await tx.query<HoldRow>(
      `INSERT INTO holds (id, commission_id, venue_id, hold_date, expires_at)
       VALUES ($1, $2, $3, $4, now() + ($5 || ' seconds')::interval)
       RETURNING *`,
      [randomUUID(), commission.id, venue.id, date, String(env.holdSeconds)],
    );
    const hold = inserted.rows[0];
    if (!hold) throw new Error('hold insert produced no row');
    await tx.query(`UPDATE commissions SET state = 'held', updated_at = now() WHERE id = $1`, [
      commission.id,
    ]);
    return hold;
  });
}

/** Serialise every attempt on one venue date. */
export async function lockVenueDay(tx: Queryable, venueId: string, date: string): Promise<void> {
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${venueId}:${date}`]);
}

export async function releaseHold(commissionId: string): Promise<void> {
  await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE holds SET released_at = now()
        WHERE commission_id = $1 AND released_at IS NULL AND booked_at IS NULL`,
      [commissionId],
    );
    await tx.query(
      `UPDATE commissions SET state = 'placed', updated_at = now()
        WHERE id = $1 AND state = 'held'`,
      [commissionId],
    );
  });
}

/** Turn the confirmed hold into the booked install day. */
export async function bookHold(
  tx: Queryable,
  hold: HoldRow,
  venue: Venue,
): Promise<string> {
  await lockVenueDay(tx, venue.id, hold.hold_date);
  const id = randomUUID();
  const inserted = await tx.query<{ id: string }>(
    `INSERT INTO install_days (id, commission_id, venue_id, install_date, starts_at, ends_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (venue_id, install_date) DO NOTHING
     RETURNING id`,
    [
      id,
      hold.commission_id,
      venue.id,
      hold.hold_date,
      startOfDay(hold.hold_date, venue.timeZone),
      endOfDay(hold.hold_date, venue.timeZone),
    ],
  );
  await tx.query('UPDATE holds SET booked_at = now() WHERE id = $1', [hold.id]);
  const dayId = inserted.rows[0]?.id;
  if (dayId) return dayId;
  const existing = await tx.query<{ id: string }>(
    'SELECT id FROM install_days WHERE venue_id = $1 AND install_date = $2',
    [venue.id, hold.hold_date],
  );
  return existing.rows[0]?.id ?? id;
}
