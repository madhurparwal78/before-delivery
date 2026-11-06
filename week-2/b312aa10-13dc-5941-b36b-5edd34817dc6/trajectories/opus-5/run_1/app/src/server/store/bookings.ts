import { randomUUID } from 'node:crypto';
import type { BookingStatus } from '../../shared/format.js';
import type { Queryable } from '../db/pool.js';
import type { BookingRow, OutOfServiceWindow, StationKind } from '../domain/types.js';

type Row = {
  id: string;
  kitchen_id: string;
  member_id: string;
  station_id: string;
  kind: StationKind;
  local_date: string;
  local_start: string | null;
  local_end: string | null;
  days: number | null;
  start_at: Date;
  end_at: Date;
  month: string;
  status: BookingStatus;
  quarter_hours: number;
  peak_quarters: number;
  charge_cents: number;
  penalty_cents: number;
  penalty_waived: boolean;
  conflict: boolean;
  series_id: string | null;
  notes: string;
  hold_expires_at: Date | null;
  confirmed_at: Date | null;
  version: number;
  seq: string;
};

const columns = `id, kitchen_id, member_id, station_id, kind, local_date, local_start, local_end,
                 days, start_at, end_at, month, status, quarter_hours, peak_quarters, charge_cents,
                 penalty_cents, penalty_waived, conflict, series_id, notes, hold_expires_at,
                 confirmed_at, version, seq`;

function toBooking(row: Row): BookingRow {
  return {
    id: row.id,
    kitchenId: row.kitchen_id,
    memberId: row.member_id,
    stationId: row.station_id,
    kind: row.kind,
    localDate: row.local_date,
    localStart: row.local_start,
    localEnd: row.local_end,
    days: row.days,
    startMs: row.start_at.getTime(),
    endMs: row.end_at.getTime(),
    month: row.month,
    status: row.status,
    quarterHours: row.quarter_hours,
    peakQuarters: row.peak_quarters,
    chargeCents: row.charge_cents,
    penaltyCents: row.penalty_cents,
    penaltyWaived: row.penalty_waived,
    conflict: row.conflict,
    seriesId: row.series_id,
    notes: row.notes,
    holdExpiresAtMs: row.hold_expires_at ? row.hold_expires_at.getTime() : null,
    confirmedAtMs: row.confirmed_at ? row.confirmed_at.getTime() : null,
    version: row.version,
    seq: String(row.seq),
  };
}

/** The occupying states: a hold occupies only until it lapses. */
function occupyingClause(nowParam: string): string {
  return `(status in ('confirmed','checked_in','completed','no_show')
           or (status = 'held' and hold_expires_at > ${nowParam}))`;
}

export async function loadBooking(
  client: Queryable,
  kitchenId: string,
  bookingId: string,
): Promise<BookingRow | null> {
  const result = await client.query<Row>(
    `select ${columns} from bookings where id = $1 and kitchen_id = $2`,
    [bookingId, kitchenId],
  );
  const row = result.rows[0];
  return row ? toBooking(row) : null;
}

export async function loadSeries(client: Queryable, seriesId: string): Promise<BookingRow[]> {
  const result = await client.query<Row>(
    `select ${columns} from bookings where series_id = $1 order by start_at`,
    [seriesId],
  );
  return result.rows.map(toBooking);
}

/** Occupying bookings overlapping an hourly span on a station. */
export async function overlappingHourly(
  client: Queryable,
  stationId: string,
  startMs: number,
  endMs: number,
  nowMs: number,
  excludeBookingId: string | null,
): Promise<BookingRow[]> {
  const result = await client.query<Row>(
    `select ${columns} from bookings
      where station_id = $1
        and ${occupyingClause('$4')}
        and start_at < $3 and end_at > $2
        and ($5::text is null or id <> $5)
      order by start_at`,
    [
      stationId,
      new Date(startMs).toISOString(),
      new Date(endMs).toISOString(),
      new Date(nowMs).toISOString(),
      excludeBookingId,
    ],
  );
  return result.rows.map(toBooking);
}

/** How many occupying shelf bookings cover each kitchen-local date. */
export async function shelfOccupancy(
  client: Queryable,
  stationId: string,
  dates: string[],
  nowMs: number,
  excludeBookingId: string | null,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>(dates.map((date) => [date, 0]));
  if (dates.length === 0) return counts;
  const result = await client.query<{ local_date: string; days: number }>(
    `select local_date, days from bookings
      where station_id = $1 and kind = 'shelf'
        and ${occupyingClause('$2')}
        and ($3::text is null or id <> $3)`,
    [stationId, new Date(nowMs).toISOString(), excludeBookingId],
  );
  for (const row of result.rows) {
    for (let offset = 0; offset < row.days; offset += 1) {
      const date = shiftDate(row.local_date, offset);
      const existing = counts.get(date);
      if (existing !== undefined) counts.set(date, existing + 1);
    }
  }
  return counts;
}

function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map((part) => Number.parseInt(part, 10));
  const moved = new Date(Date.UTC(year!, month! - 1, day! + days));
  return moved.toISOString().slice(0, 10);
}

/** The bookings a board shows for a kitchen-local date. */
export async function boardBookings(
  client: Queryable,
  kitchenId: string,
  date: string,
): Promise<BookingRow[]> {
  const result = await client.query<Row>(
    `select ${columns} from bookings b
      where kitchen_id = $1
        and status in ('held','confirmed','checked_in','completed','no_show','expired')
        and ((kind = 'hourly' and local_date = $2)
             or (kind = 'shelf' and local_date <= $2 and $2::date < (local_date::date + days)))
      order by start_at, seq`,
    [kitchenId, date],
  );
  const stationOrder = await client.query<{ id: string; lane_order: number }>(
    `select id, lane_order from stations where kitchen_id = $1`,
    [kitchenId],
  );
  const lanes = new Map(stationOrder.rows.map((row) => [row.id, row.lane_order]));
  return result.rows
    .map(toBooking)
    .sort(
      (a, b) =>
        (lanes.get(a.stationId) ?? 0) - (lanes.get(b.stationId) ?? 0) ||
        a.startMs - b.startMs ||
        Number(a.seq) - Number(b.seq),
    );
}

/** Bookings whose current block starts in a month and that ever reached confirmed, plus live holds. */
export async function monthBookings(
  client: Queryable,
  kitchenId: string,
  month: string,
  memberId: string | null,
  nowMs: number,
): Promise<BookingRow[]> {
  const result = await client.query<Row>(
    `select ${columns} from bookings
      where kitchen_id = $1 and month = $2
        and ($3::text is null or member_id = $3)
        and (confirmed_at is not null
             or (status = 'held' and hold_expires_at > $4))
      order by start_at, seq`,
    [kitchenId, month, memberId, new Date(nowMs).toISOString()],
  );
  return result.rows.map(toBooking);
}

/** Counted and late-cancelled bookings of a month, for invoices and reports. */
export async function monthBookingsAll(
  client: Queryable,
  kitchenId: string,
  month: string,
): Promise<BookingRow[]> {
  const result = await client.query<Row>(
    `select ${columns} from bookings
      where kitchen_id = $1 and month = $2 and confirmed_at is not null
      order by start_at, seq`,
    [kitchenId, month],
  );
  return result.rows.map(toBooking);
}

export async function membersOwnBoardBookings(
  client: Queryable,
  kitchenId: string,
  memberId: string,
  date: string,
): Promise<BookingRow[]> {
  const all = await boardBookings(client, kitchenId, date);
  return all.filter((booking) => booking.memberId === memberId);
}

export type NewBooking = {
  kitchenId: string;
  memberId: string;
  stationId: string;
  kind: StationKind;
  localDate: string;
  localStart: string | null;
  localEnd: string | null;
  days: number | null;
  startMs: number;
  endMs: number;
  month: string;
  quarterHours: number;
  peakQuarters: number;
  chargeCents: number;
  notes: string;
  seriesId: string | null;
  holdExpiresAtMs: number;
};

export async function insertHold(client: Queryable, booking: NewBooking): Promise<BookingRow> {
  const result = await client.query<Row>(
    `insert into bookings (id, kitchen_id, member_id, station_id, kind, local_date, local_start,
                           local_end, days, start_at, end_at, month, status, quarter_hours,
                           peak_quarters, charge_cents, notes, series_id, hold_expires_at, version)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'held',$13,$14,$15,$16,$17,$18,1)
     returning ${columns}`,
    [
      `bkg_${randomUUID()}`,
      booking.kitchenId,
      booking.memberId,
      booking.stationId,
      booking.kind,
      booking.localDate,
      booking.localStart,
      booking.localEnd,
      booking.days,
      new Date(booking.startMs).toISOString(),
      new Date(booking.endMs).toISOString(),
      booking.month,
      booking.quarterHours,
      booking.peakQuarters,
      booking.chargeCents,
      booking.notes,
      booking.seriesId,
      new Date(booking.holdExpiresAtMs).toISOString(),
    ],
  );
  return toBooking(result.rows[0]!);
}

export async function setStatus(
  client: Queryable,
  bookingId: string,
  status: BookingStatus,
  extra: {
    confirmedAtMs?: number;
    penaltyCents?: number;
    penaltyWaived?: boolean;
    conflict?: boolean;
  } = {},
): Promise<BookingRow> {
  const result = await client.query<Row>(
    `update bookings set status = $2,
            version = version + 1,
            confirmed_at = coalesce($3, confirmed_at),
            penalty_cents = coalesce($4, penalty_cents),
            penalty_waived = coalesce($5, penalty_waived),
            conflict = coalesce($6, conflict)
      where id = $1 returning ${columns}`,
    [
      bookingId,
      status,
      extra.confirmedAtMs === undefined ? null : new Date(extra.confirmedAtMs).toISOString(),
      extra.penaltyCents ?? null,
      extra.penaltyWaived ?? null,
      extra.conflict ?? null,
    ],
  );
  return toBooking(result.rows[0]!);
}

export async function setWaived(client: Queryable, bookingId: string): Promise<BookingRow> {
  const result = await client.query<Row>(
    `update bookings set penalty_waived = true, version = version + 1
      where id = $1 returning ${columns}`,
    [bookingId],
  );
  return toBooking(result.rows[0]!);
}

export async function setConflict(
  client: Queryable,
  bookingId: string,
  conflict: boolean,
): Promise<void> {
  await client.query(
    `update bookings set conflict = $2, version = version + 1 where id = $1 and conflict <> $2`,
    [bookingId, conflict],
  );
}

export async function applyMove(
  client: Queryable,
  bookingId: string,
  block: {
    stationId: string;
    localDate: string;
    localStart: string | null;
    localEnd: string | null;
    days: number | null;
    startMs: number;
    endMs: number;
    month: string;
    quarterHours: number;
    peakQuarters: number;
    chargeCents: number;
    conflict: boolean;
  },
): Promise<BookingRow> {
  const result = await client.query<Row>(
    `update bookings set station_id = $2, local_date = $3, local_start = $4, local_end = $5,
            days = $6, start_at = $7, end_at = $8, month = $9, quarter_hours = $10,
            peak_quarters = $11, charge_cents = $12, conflict = $13, version = version + 1
      where id = $1 returning ${columns}`,
    [
      bookingId,
      block.stationId,
      block.localDate,
      block.localStart,
      block.localEnd,
      block.days,
      new Date(block.startMs).toISOString(),
      new Date(block.endMs).toISOString(),
      block.month,
      block.quarterHours,
      block.peakQuarters,
      block.chargeCents,
      block.conflict,
    ],
  );
  return toBooking(result.rows[0]!);
}

export async function bookingsNeedingLapse(
  client: Queryable,
  nowMs: number,
): Promise<BookingRow[]> {
  const result = await client.query<Row>(
    `select ${columns} from bookings
      where (status = 'held' and hold_expires_at <= $1)
         or (status = 'confirmed' and start_at <= $1)
      order by seq`,
    [new Date(nowMs).toISOString()],
  );
  return result.rows.map(toBooking);
}

type WindowRow = {
  id: string;
  kitchen_id: string;
  station_id: string;
  start_at: Date;
  end_at: Date;
  local_date: string;
  local_start: string;
  local_end: string;
  reason: string;
};

function toWindow(row: WindowRow): OutOfServiceWindow {
  return {
    id: row.id,
    kitchenId: row.kitchen_id,
    stationId: row.station_id,
    startMs: row.start_at.getTime(),
    endMs: row.end_at.getTime(),
    localDate: row.local_date,
    localStart: row.local_start,
    localEnd: row.local_end,
    reason: row.reason,
  };
}

const windowColumns = `id, kitchen_id, station_id, start_at, end_at, local_date, local_start,
                       local_end, reason`;

export async function stationWindows(
  client: Queryable,
  stationId: string,
): Promise<OutOfServiceWindow[]> {
  const result = await client.query<WindowRow>(
    `select ${windowColumns} from out_of_service where station_id = $1 order by start_at`,
    [stationId],
  );
  return result.rows.map(toWindow);
}

export async function windowsOverlappingDate(
  client: Queryable,
  kitchenId: string,
  dayStartMs: number,
  dayEndMs: number,
): Promise<OutOfServiceWindow[]> {
  const result = await client.query<WindowRow>(
    `select w.id, w.kitchen_id, w.station_id, w.start_at, w.end_at, w.local_date,
            w.local_start, w.local_end, w.reason
       from out_of_service w join stations s on s.id = w.station_id
      where w.kitchen_id = $1 and w.start_at < $3 and w.end_at > $2
      order by s.lane_order, w.start_at`,
    [kitchenId, new Date(dayStartMs).toISOString(), new Date(dayEndMs).toISOString()],
  );
  return result.rows.map(toWindow);
}

export async function insertWindow(
  client: Queryable,
  window: Omit<OutOfServiceWindow, 'id'>,
): Promise<OutOfServiceWindow> {
  const result = await client.query<WindowRow>(
    `insert into out_of_service (id, kitchen_id, station_id, start_at, end_at, local_date,
                                 local_start, local_end, reason)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning ${windowColumns}`,
    [
      `oos_${randomUUID()}`,
      window.kitchenId,
      window.stationId,
      new Date(window.startMs).toISOString(),
      new Date(window.endMs).toISOString(),
      window.localDate,
      window.localStart,
      window.localEnd,
      window.reason,
    ],
  );
  return toWindow(result.rows[0]!);
}

export async function loadWindow(
  client: Queryable,
  kitchenId: string,
  windowId: string,
): Promise<OutOfServiceWindow | null> {
  const result = await client.query<WindowRow>(
    `select ${windowColumns} from out_of_service where id = $1 and kitchen_id = $2`,
    [windowId, kitchenId],
  );
  const row = result.rows[0];
  return row ? toWindow(row) : null;
}

export async function deleteWindow(client: Queryable, windowId: string): Promise<void> {
  await client.query(`delete from out_of_service where id = $1`, [windowId]);
}

export async function stationBookingsInRange(
  client: Queryable,
  stationId: string,
  startMs: number,
  endMs: number,
  statuses: BookingStatus[],
): Promise<BookingRow[]> {
  const result = await client.query<Row>(
    `select ${columns} from bookings
      where station_id = $1 and status = any($4::text[])
        and start_at < $3 and end_at > $2
      order by start_at`,
    [
      stationId,
      new Date(startMs).toISOString(),
      new Date(endMs).toISOString(),
      statuses,
    ],
  );
  return result.rows.map(toBooking);
}

export async function stationBookingsInStatuses(
  client: Queryable,
  stationId: string,
  statuses: BookingStatus[],
): Promise<BookingRow[]> {
  const result = await client.query<Row>(
    `select ${columns} from bookings where station_id = $1 and status = any($2::text[])
      order by start_at`,
    [stationId, statuses],
  );
  return result.rows.map(toBooking);
}
