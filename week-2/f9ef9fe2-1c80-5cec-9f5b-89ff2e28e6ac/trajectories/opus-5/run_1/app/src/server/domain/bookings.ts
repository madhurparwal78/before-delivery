import type { Booking, BookingState, Cell, Line } from '../../shared/types.js';
import { formatHours, formatMoney, minutesToHHMM } from '../../shared/format.js';
import { query, queryOne, type Sql } from '../db/pool.js';
import { cellBlocks, type StationRef } from './pricing.js';

/** The only booking state machine. */
const TRANSITIONS: Record<BookingState, readonly BookingState[]> = {
  confirmed: ['checked_in', 'no_show', 'cancelled_in_window', 'cancelled_late'],
  checked_in: ['completed'],
  completed: [],
  no_show: [],
  cancelled_in_window: [],
  cancelled_late: [],
};

export function canTransition(from: BookingState, to: BookingState): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface BookingRow {
  id: string;
  ref: string;
  kitchen_id: string;
  member_id: string;
  series_id: string | null;
  invoice_id: string | null;
  date: string;
  state: BookingState;
  rate_card_id: string;
  cancellation_window_hours: number;
  pack_quarters: number;
  total_cents: number;
  starts_at: Date;
  ends_at: Date;
  confirmed_at: Date;
  business: string;
}

const BOOKING_COLUMNS = `b.id, b.ref, b.kitchen_id, b.member_id, b.series_id, b.invoice_id, b.date,
  b.state, b.rate_card_id, b.cancellation_window_hours, b.pack_quarters, b.total_cents,
  b.starts_at, b.ends_at, b.confirmed_at, m.business`;

export async function loadBooking(client: Sql, bookingId: string): Promise<BookingRow | null> {
  return queryOne<BookingRow>(
    client,
    `SELECT ${BOOKING_COLUMNS} FROM bookings b JOIN members m ON m.id = b.member_id WHERE b.id = $1`,
    [bookingId],
  );
}

export async function loadBookingForUpdate(
  client: Sql,
  bookingId: string,
): Promise<BookingRow | null> {
  return queryOne<BookingRow>(
    client,
    `SELECT ${BOOKING_COLUMNS} FROM bookings b JOIN members m ON m.id = b.member_id
      WHERE b.id = $1 FOR UPDATE OF b`,
    [bookingId],
  );
}

export async function loadBookings(
  client: Sql,
  filter: { kitchenId: string; memberId?: string; date?: string },
): Promise<BookingRow[]> {
  const conditions = ['b.kitchen_id = $1'];
  const values: unknown[] = [filter.kitchenId];
  if (filter.memberId !== undefined) {
    values.push(filter.memberId);
    conditions.push(`b.member_id = $${values.length}`);
  }
  if (filter.date !== undefined) {
    values.push(filter.date);
    conditions.push(`b.date = $${values.length}`);
  }
  return query<BookingRow>(
    client,
    `SELECT ${BOOKING_COLUMNS} FROM bookings b JOIN members m ON m.id = b.member_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY b.date, b.starts_at, b.ref`,
    values,
  );
}

export async function loadBookingCells(
  client: Sql,
  bookingId: string,
): Promise<{ station_id: string; start_minute: number }[]> {
  return query<{ station_id: string; start_minute: number }>(
    client,
    'SELECT station_id, start_minute FROM booking_cells WHERE booking_id = $1 ORDER BY start_minute, station_id',
    [bookingId],
  );
}

export interface BookingLineRow {
  booking_id: string;
  station_id: string;
  tier: 1 | 2 | 3 | 4;
  paid_by: 'cash' | 'pack';
  quarters: number;
  hourly_rate_cents: number;
  amount_cents: number;
}

export async function loadBookingLines(
  client: Sql,
  bookingIds: readonly string[],
): Promise<BookingLineRow[]> {
  if (bookingIds.length === 0) return [];
  return query<BookingLineRow>(
    client,
    `SELECT booking_id, station_id, tier, paid_by, quarters, hourly_rate_cents, amount_cents
       FROM booking_lines WHERE booking_id = ANY($1::text[]) ORDER BY booking_id, idx`,
    [[...bookingIds]],
  );
}

export function lineView(row: BookingLineRow, stations: Map<string, StationRef>): Line {
  const station = stations.get(row.station_id);
  return {
    station_id: row.station_id,
    station: station ? station.name : row.station_id,
    tier: row.tier,
    paid_by: row.paid_by,
    quarters: row.quarters,
    hours: formatHours(row.quarters),
    hourly_rate_cents: row.hourly_rate_cents,
    amount_cents: row.amount_cents,
  };
}

export function bookingView(
  row: BookingRow,
  cells: readonly { station_id: string; start_minute: number }[],
  lines: readonly BookingLineRow[],
  stations: Map<string, StationRef>,
): Booking {
  const cellViews: Cell[] = cells.map((cell) => ({
    station_id: cell.station_id,
    start: minutesToHHMM(cell.start_minute),
  }));
  return {
    id: row.id,
    ref: row.ref,
    member_id: row.member_id,
    kitchen_id: row.kitchen_id,
    date: row.date,
    state: row.state,
    cells: cellViews,
    blocks: cellBlocks(cells, stations),
    starts_at: row.starts_at.toISOString(),
    ends_at: row.ends_at.toISOString(),
    quarters: cells.length,
    hours: formatHours(cells.length),
    lines: lines.map((line) => lineView(line, stations)),
    pack_quarters: row.pack_quarters,
    total_cents: row.total_cents,
    total: formatMoney(row.total_cents),
    rate_card_id: row.rate_card_id,
    cancellation_window_hours: row.cancellation_window_hours,
    confirmed_at: row.confirmed_at.toISOString(),
    invoice_id: row.invoice_id,
    series_id: row.series_id,
    business: row.business,
  };
}

/** Loads whole bookings in one pass, for list screens. */
export async function bookingViews(
  client: Sql,
  rows: readonly BookingRow[],
  stations: Map<string, StationRef>,
): Promise<Booking[]> {
  const ids = rows.map((row) => row.id);
  const lines = await loadBookingLines(client, ids);
  const cells =
    ids.length === 0
      ? []
      : await query<{ booking_id: string; station_id: string; start_minute: number }>(
          client,
          `SELECT booking_id, station_id, start_minute FROM booking_cells
            WHERE booking_id = ANY($1::text[]) ORDER BY start_minute, station_id`,
          [ids],
        );
  return rows.map((row) =>
    bookingView(
      row,
      cells.filter((cell) => cell.booking_id === row.id),
      lines.filter((line) => line.booking_id === row.id),
      stations,
    ),
  );
}

export async function nextBookingRef(client: Sql): Promise<string> {
  const row = await queryOne<{ value: string }>(
    client,
    "SELECT nextval('booking_ref_seq')::text AS value",
  );
  return `PL-${String(row ? Number(row.value) : 0).padStart(6, '0')}`;
}

export async function recordStateChange(
  client: Sql,
  input: {
    actorId: string | null;
    kitchenId: string;
    subject: string;
    subjectId: string;
    from: string | null;
    to: string;
    now: Date;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events (at, actor_id, kitchen_id, subject, subject_id, from_state, to_state)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [input.now, input.actorId, input.kitchenId, input.subject, input.subjectId, input.from, input.to],
  );
}
