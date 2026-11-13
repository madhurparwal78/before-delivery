import { query, type Db } from '../db';
import { CLEANUP_MINUTES } from '../../shared/copy';
import { hhmmOfMinutes } from '../../shared/format';
import { closingMinutes, instantOfKitchenLocal, openingMinutes } from '../kitchen-time';
import type { BookingStatus, CoolerFreeCell } from '../../shared/types';

export interface OccupiedPeriod {
  bookingId: string;
  tenantId: string;
  tenantName: string;
  stationId: string;
  status: BookingStatus;
  start: Date;
  end: Date;
  bufferEnd: Date;
}

export const COOLER_CELL_COUNT = 36;
export const COOLER_CELL_MINUTES = 30;

export function bufferEndOf(end: Date): Date {
  return new Date(end.getTime() + CLEANUP_MINUTES * 60000);
}

/** Minutes a booking takes from its pack: span minutes times the stations it occupies. */
export function bookingMinutes(start: Date, end: Date, stationCount: number): number {
  return Math.round((end.getTime() - start.getTime()) / 60000) * stationCount;
}

/** Live occupancy overlapping a window, with expired holds excluded at this request's now. */
export async function occupiedPeriods(
  client: Db,
  from: Date,
  to: Date,
  now: Date,
): Promise<OccupiedPeriod[]> {
  const rows = await query<{
    booking_id: string;
    tenant_id: string;
    tenant_name: string;
    station_id: string;
    status: BookingStatus;
    start_at: Date;
    end_at: Date;
    buffer_end_at: Date;
  }>(
    client,
    `select o.booking_id, b.tenant_id, t.business_name as tenant_name, o.station_id, b.status,
            b.start_at, b.end_at, b.buffer_end_at
     from booking_occupancies o
     join bookings b on b.id = o.booking_id
     join tenants t on t.id = b.tenant_id
     where o.period && tstzrange($1, $2, '[)')
       and b.status <> 'cancelled'
       and (b.status <> 'held' or b.hold_expires_at > $3)
     order by b.start_at, o.station_id`,
    [from, to, now],
  );
  return rows.map((row) => ({
    bookingId: row.booking_id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    stationId: row.station_id,
    status: row.status,
    start: row.start_at,
    end: row.end_at,
    bufferEnd: row.buffer_end_at,
  }));
}

interface Window {
  from: number;
  to: number;
}

function clampedMinutes(ranges: ReadonlyArray<Window>, span: Window): number {
  const sorted = ranges
    .map((range) => ({ from: Math.max(range.from, span.from), to: Math.min(range.to, span.to) }))
    .filter((range) => range.to > range.from)
    .sort((left, right) => left.from - right.from);
  let total = 0;
  let cursor = -Infinity;
  for (const range of sorted) {
    const from = Math.max(range.from, cursor);
    if (range.to > from) {
      total += range.to - from;
      cursor = range.to;
    }
  }
  return Math.round(total / 60000);
}

export interface StationMetrics {
  occupiedMinutes: number;
  bufferMinutes: number;
  freeMinutes: number;
}

/** Station metrics for a requested span. */
export function stationMetrics(
  periods: ReadonlyArray<OccupiedPeriod>,
  stationId: string,
  spanStart: Date,
  spanEnd: Date,
): StationMetrics {
  const span: Window = { from: spanStart.getTime(), to: spanEnd.getTime() };
  const spanMinutes = Math.round((span.to - span.from) / 60000);
  const mine = periods.filter((period) => period.stationId === stationId);
  const occupiedMinutes = clampedMinutes(
    mine.map((period) => ({ from: period.start.getTime(), to: period.bufferEnd.getTime() })),
    span,
  );
  const bookedMinutes = clampedMinutes(
    mine.map((period) => ({ from: period.start.getTime(), to: period.end.getTime() })),
    span,
  );
  return {
    occupiedMinutes,
    bufferMinutes: occupiedMinutes - bookedMinutes,
    freeMinutes: spanMinutes - occupiedMinutes,
  };
}

/** The 36 half-hour cooler cells of a kitchen date, from the same occupancy read. */
export function coolerFreeCells(
  periods: ReadonlyArray<OccupiedPeriod>,
  shelfIds: ReadonlyArray<string>,
  date: string,
): CoolerFreeCell[] {
  const cells: CoolerFreeCell[] = [];
  for (let index = 0; index < COOLER_CELL_COUNT; index += 1) {
    const cellStartMinutes = openingMinutes + index * COOLER_CELL_MINUTES;
    const cellStart = instantOfKitchenLocal(date, cellStartMinutes).getTime();
    const cellEnd = instantOfKitchenLocal(date, cellStartMinutes + COOLER_CELL_MINUTES).getTime();
    const freeShelves = shelfIds.filter(
      (shelfId) =>
        !periods.some(
          (period) =>
            period.stationId === shelfId &&
            period.start.getTime() < cellEnd &&
            period.bufferEnd.getTime() > cellStart,
        ),
    ).length;
    cells.push({ time: hhmmOfMinutes(cellStartMinutes), freeShelves });
  }
  return cells;
}

/** Window covering a kitchen date's operating hours plus cleanup buffers. */
export function dateWindow(date: string): { from: Date; to: Date } {
  return {
    from: instantOfKitchenLocal(date, openingMinutes - CLEANUP_MINUTES),
    to: instantOfKitchenLocal(date, closingMinutes + CLEANUP_MINUTES),
  };
}

/** Frees stations held by holds whose expiry has passed at this transaction's now. */
export async function releaseExpiredHolds(client: Db, now: Date): Promise<void> {
  const expired = await query<{ id: string }>(
    client,
    `update bookings set status = 'cancelled', cancel_reason = 'hold_expired'
     where status = 'held' and hold_expires_at <= $1
     returning id`,
    [now],
  );
  if (expired.length === 0) return;
  await query(client, 'delete from booking_occupancies where booking_id = any($1::uuid[])', [
    expired.map((row) => row.id),
  ]);
}
