import { query, queryOne, type Db } from '../db.js';
import { conflict, illegalTransition } from '../errors.js';
import { appendEvent, barnDayChannel, type StreamRole } from '../stream.js';
import { cancellationCutoffAt, formatInstant, startsAt } from './time.js';

/**
 * Barn days. The stored status is draft, published, in progress, closed or cancelled;
 * the API reads a published day as full exactly when its booked count equals its slot
 * count, judged at the moment of the read.
 */
export type StoredDayStatus = 'draft' | 'published' | 'in_progress' | 'closed' | 'cancelled';
export type DayStatus = StoredDayStatus | 'full';

export type DayAction = 'edit' | 'publish' | 'start' | 'close' | 'cancel';

export interface BarnDayRow {
  id: string;
  barn_id: string;
  barn_name: string;
  business_date: string;
  start_time: string;
  starts_at: Date;
  cancellation_cutoff_at: Date;
  slot_count: number;
  slot_minutes: number;
  trip_fee_cents: number;
  status: StoredDayStatus;
  started_at: Date | null;
  closed_at: Date | null;
}

export const DAY_COLUMNS = `d.id, d.barn_id, b.name AS barn_name,
  to_char(d.business_date,'YYYY-MM-DD') AS business_date, d.start_time, d.starts_at,
  d.cancellation_cutoff_at, d.slot_count, d.slot_minutes, d.trip_fee_cents, d.status,
  d.started_at, d.closed_at`;

export const LIVE_BOOKING_STATUSES = ['held', 'confirmed', 'worked', 'no_show'] as const;

export async function loadBarnDay(db: Db, id: string, lock = false): Promise<BarnDayRow | null> {
  if (lock) {
    // The row lock serialises every change to this day and its bookings.
    const locked = await queryOne<{ id: string }>(
      db,
      'SELECT id FROM barn_days WHERE id = $1 FOR UPDATE',
      [id],
    );
    if (locked === null) return null;
  }
  return await queryOne<BarnDayRow>(
    db,
    `SELECT ${DAY_COLUMNS} FROM barn_days d JOIN barns b ON b.id = d.barn_id WHERE d.id = $1`,
    [id],
  );
}

/**
 * The booked count is the number of the day's slots taken by a live booking. A held
 * booking stops counting at and after its stored expiry instant, on every read.
 */
export async function bookedCount(db: Db, barnDayId: string, at: Date): Promise<number> {
  const row = await queryOne<{ count: number }>(
    db,
    `SELECT COUNT(DISTINCT slot_id)::int AS count FROM bookings
     WHERE barn_day_id = $1
       AND (status IN ('confirmed','worked','no_show')
            OR (status = 'held' AND hold_expires_at > $2))`,
    [barnDayId, at],
  );
  return row?.count ?? 0;
}

/** Full and published are derived from live bookings on every read. */
export function derivedStatus(stored: StoredDayStatus, booked: number, slotCount: number): DayStatus {
  if (stored === 'published' && booked >= slotCount) return 'full';
  return stored;
}

export async function dayStatusNow(db: Db, day: BarnDayRow, at: Date): Promise<DayStatus> {
  const booked = await bookedCount(db, day.id, at);
  return derivedStatus(day.status, booked, day.slot_count);
}

export interface SlotRow {
  id: string;
  position: number;
  slot_time: string;
  booking_id: string | null;
  booking_owner_id: string | null;
}

export async function slotsWithState(db: Db, barnDayId: string, at: Date): Promise<SlotRow[]> {
  return await query<SlotRow>(
    db,
    `SELECT s.id, s.position, s.slot_time,
            live.id AS booking_id, live.owner_id AS booking_owner_id
     FROM slots s
     LEFT JOIN bookings live ON live.slot_id = s.id
       AND (live.status IN ('confirmed','worked','no_show')
            OR (live.status = 'held' AND live.hold_expires_at > $2))
     WHERE s.barn_day_id = $1
     ORDER BY s.position`,
    [barnDayId, at],
  );
}

/** The transitions a barn day may take, and nothing else. */
const EDGES: Record<DayAction, readonly StoredDayStatus[]> = {
  edit: ['draft'],
  publish: ['draft'],
  start: ['published'],
  close: ['in_progress'],
  cancel: ['draft', 'published'],
};

/**
 * Refuses an action the day's own status makes illegal. This 409 comes before the
 * action's own guard 409s, and reports the status exactly as the API prints it.
 */
export function assertTransition(day: BarnDayRow, action: DayAction, printed: DayStatus): void {
  if (!EDGES[action].includes(day.status)) {
    throw illegalTransition(printed, action);
  }
}

export function assertPublishAllowed(day: BarnDayRow, today: string): void {
  if (day.business_date < today) throw conflict('date_passed');
}

export function assertStartAllowed(day: BarnDayRow, today: string): void {
  if (day.business_date > today) throw conflict('too_early');
}

export const STREAM_ROLES: readonly StreamRole[] = ['farrier', 'apprentice', 'barn_manager'];

/** A change between published and full, or any stored status change, reaches every role's stream. */
export async function announceDayStatus(
  db: Db,
  barnDayId: string,
  status: DayStatus,
  at: Date,
): Promise<void> {
  for (const role of STREAM_ROLES) {
    await appendEvent(db, barnDayChannel(barnDayId, role), 'day_status', { status }, at);
  }
}

export interface BarnDayJsonOptions {
  booked: number;
  status: DayStatus;
  slots: { id: string; time: string; state: 'open' | 'taken'; myBookingId: string | null }[];
  timeZone: string;
  includeTripFee: boolean;
  includeMyBooking: boolean;
}

export function barnDayJson(day: BarnDayRow, options: BarnDayJsonOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {
    id: day.id,
    barn: { id: day.barn_id, name: day.barn_name },
    business_date: day.business_date,
    start_time: day.start_time,
    time_zone: options.timeZone,
    starts_at: formatInstant(day.starts_at, options.timeZone),
    cancellation_cutoff_at: formatInstant(day.cancellation_cutoff_at, options.timeZone),
    slot_count: day.slot_count,
    slot_minutes: day.slot_minutes,
    booked_count: options.booked,
    status: options.status,
    slots: options.slots.map((slot) => {
      const entry: Record<string, unknown> = { id: slot.id, time: slot.time, state: slot.state };
      if (options.includeMyBooking) entry.my_booking_id = slot.myBookingId;
      return entry;
    }),
  };
  if (options.includeTripFee) body.trip_fee_cents = day.trip_fee_cents;
  return body;
}

/** Recomputes the stored start and cutoff from a wall-clock date and time. */
export function computeDayInstants(
  businessDate: string,
  startTime: string,
  zone: string,
): { startsAt: Date; cutoffAt: Date } | null {
  const start = startsAt(businessDate, startTime, zone);
  if (start === null) return null;
  return { startsAt: start, cutoffAt: cancellationCutoffAt(start) };
}
