import type { PoolClient } from 'pg';

/** A pg date column arrives as a Date at local midnight; Lineboard uses its ISO date string. */
export function isoDate(value: string | Date): string {
  if (typeof value === 'string') return value;
  return value.toISOString().slice(0, 10);
}
import { ApiError, statusWord } from './errors.js';
import { formatHours, monthOf } from './time.js';
import { blockLabel } from './copy.js';

export type BookingStatus =
  | 'held'
  | 'confirmed'
  | 'checked_in'
  | 'completed'
  | 'no_show'
  | 'cancelled_free'
  | 'cancelled_late'
  | 'expired';

export interface BookingRow {
  id: string;
  kitchen_id: string;
  member_id: string;
  station_id: string;
  kind: 'hourly' | 'shelf';
  local_date: string;
  local_start: string | null;
  local_end: string | null;
  days: number | null;
  start_at: Date;
  end_at: Date;
  status: BookingStatus;
  series_id: string | null;
  notes: string;
  hold_expires_at: Date | null;
  confirmed_at: Date | null;
  charge_cents: number;
  penalty_cents: number;
  penalty_waived: boolean;
  conflict: boolean;
  version: number;
  hours: string;
  peak_hours: string;
}

export const OCCUPYING: BookingStatus[] = ['held', 'confirmed', 'checked_in', 'completed', 'no_show'];

/** The grace instant: grace seconds after the later of block start and confirmation. */
export function graceInstant(booking: BookingRow, graceSeconds: number): Date {
  const base = Math.max(booking.start_at.getTime(), booking.confirmed_at?.getTime() ?? 0);
  return new Date(base + graceSeconds * 1000);
}

export function checkInOpensAt(booking: BookingRow): Date {
  return new Date(booking.start_at.getTime() - 60 * 60 * 1000);
}

/**
 * Applies any automatic hold lapse or no-show that is already due, before
 * every state check. Stores the new status and increments version once.
 */
export async function applyLapses(client: PoolClient, bookingId: string, now: Date, graceSeconds: number): Promise<BookingRow> {
  const booking = await getBookingForUpdate(client, bookingId);
  if (booking.status === 'held' && booking.hold_expires_at && booking.hold_expires_at.getTime() <= now.getTime()) {
    await client.query(`UPDATE bookings SET status='expired', version=version+1 WHERE id=$1`, [bookingId]);
    booking.status = 'expired';
    booking.version += 1;
  } else if (booking.status === 'confirmed') {
    const grace = graceInstant(booking, graceSeconds);
    if (grace.getTime() <= now.getTime()) {
      const closedMonth = await client.query<{ closed: boolean }>(
        `SELECT closed FROM invoice_state WHERE kitchen_id=$1 AND month=$2`,
        [booking.kitchen_id, monthOf(booking.local_date)],
      );
      const isClosed = closedMonth.rows[0]?.closed === true;
      if (!isClosed) {
        await client.query(`UPDATE bookings SET status='no_show', version=version+1 WHERE id=$1`, [bookingId]);
        booking.status = 'no_show';
        booking.version += 1;
      }
    }
  }
  return booking;
}

export async function getBookingForUpdate(client: PoolClient, bookingId: string): Promise<BookingRow> {
  const result = await client.query<BookingRow>(`SELECT * FROM bookings WHERE id=$1 FOR UPDATE`, [bookingId]);
  if (result.rows.length === 0) throw new ApiError('not_found');
  return result.rows[0];
}

export async function getBooking(client: PoolClient, bookingId: string): Promise<BookingRow | null> {
  const result = await client.query<BookingRow>(`SELECT * FROM bookings WHERE id=$1`, [bookingId]);
  return result.rows[0] ?? null;
}

/**
 * Offered actions for a caller at an instant: fixed order, judged from the
 * transition table after any lapse that is due. Ignores checks that read
 * other stored records (free time, out-of-service, hours, documents).
 */
export function offeredActions(
  booking: BookingRow,
  caller: { personId: string; role: 'operator' | 'shift_lead' | 'member'; memberId: string | null },
  now: Date,
  graceSeconds: number,
  monthClosed: boolean,
): string[] {
  const actions: string[] = [];
  if (monthClosed) {
    if (booking.status === 'cancelled_late' && !booking.penalty_waived && caller.role === 'operator') {
      actions.push('waive_penalty');
    }
    return actions;
  }
  const isStaff = caller.role === 'operator' || caller.role === 'shift_lead';
  const isOwner = caller.memberId !== null && caller.memberId === booking.member_id;
  switch (booking.status) {
    case 'held':
      if (isOwner) actions.push('confirm', 'cancel');
      break;
    case 'confirmed': {
      if (isOwner || caller.role === 'operator') actions.push('cancel');
      if (isStaff) {
        const grace = graceInstant(booking, graceSeconds);
        if (now.getTime() >= checkInOpensAt(booking).getTime() && now.getTime() < grace.getTime()) actions.push('check_in');
        if (now.getTime() >= booking.start_at.getTime() && now.getTime() < grace.getTime()) actions.push('no_show');
        actions.push('move');
        if (booking.conflict) actions.push('release');
      }
      break;
    }
    case 'checked_in':
      if (isStaff) actions.push('check_out');
      break;
    case 'cancelled_late':
      if (caller.role === 'operator' && !booking.penalty_waived) actions.push('waive_penalty');
      break;
    default:
      break;
  }
  const order = ['confirm', 'cancel', 'check_in', 'check_out', 'no_show', 'move', 'release', 'waive_penalty'];
  return order.filter((a) => actions.includes(a));
}

/** Occupancy: on an hourly station two occupying bookings never overlap; a shelf day holds at most capacity. */
export function occupancyQuery(stationId: string, start: Date, end: Date, excludeBookingId?: string): { sql: string; params: unknown[] } {
  if (excludeBookingId) {
    return {
      sql: `SELECT id FROM bookings WHERE station_id=$1 AND status = ANY($5) AND start_at<$3 AND end_at>$2 AND id<>$4`,
      params: [stationId, start, end, excludeBookingId, OCCUPYING],
    };
  }
  return {
    sql: `SELECT id FROM bookings WHERE station_id=$1 AND status = ANY($4) AND start_at<$3 AND end_at>$2`,
    params: [stationId, start, end, OCCUPYING],
  };
}

export async function timeIsFree(
  client: PoolClient,
  stationId: string,
  start: Date,
  end: Date,
  excludeBookingId?: string,
): Promise<boolean> {
  const { sql, params } = occupancyQuery(stationId, start, end, excludeBookingId);
  const result = await client.query(sql, params);
  return result.rows.length === 0;
}

/** Free shelf slots per kitchen-local day, for shelf capacity checks. */
export async function shelfDaysFull(
  client: PoolClient,
  stationId: string,
  capacity: number,
  localDates: string[],
  excludeBookingId?: string,
): Promise<string[]> {
  if (localDates.length === 0) return [];
  const exact = await client.query<{ local_date: string; days: number }>(
    `SELECT local_date::text, days FROM bookings
      WHERE station_id=$1 AND status=ANY($2) AND kind='shelf'
        AND local_date <= (SELECT max(x) FROM unnest($3::date[]) x)
        AND local_date + (days-1) >= (SELECT min(x) FROM unnest($3::date[]) x)
        AND ($4::text IS NULL OR id<>$4)`,
    [stationId, OCCUPYING, localDates, excludeBookingId ?? null],
  );
  const dayCounts = new Map<string, number>();
  for (const row of exact.rows) {
    const start = row.local_date;
    for (let i = 0; i < row.days; i++) {
      const d = addDaysIso(start, i);
      dayCounts.set(d, (dayCounts.get(d) ?? 0) + 1);
    }
  }
  const full: string[] = [];
  for (const d of localDates) {
    if ((dayCounts.get(d) ?? 0) >= capacity) full.push(d);
  }
  return full;
}

function addDaysIso(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

export function invalidTransition(booking: BookingRow, action: string): ApiError {
  return new ApiError(
    'invalid_transition',
    { from: booking.status, action, current: booking },
    (n) => (n === 'statusWord' ? statusWord(booking.status) : ''),
  );
}

export function bookingLabel(booking: BookingRow, stationName: string): string {
  return blockLabel({
    stationName,
    kind: booking.kind,
    localDate: booking.local_date,
    localStart: booking.local_start,
    localEnd: booking.local_end,
    days: booking.days,
  });
}

export function formatBookingHours(booking: BookingRow): { hours: string; peakHours: string } {
  return { hours: formatHours(Number(booking.hours)), peakHours: formatHours(Number(booking.peak_hours)) };
}
