import type { SegmentState } from '../../shared/types.js';
import { query, type Db } from '../db/pool.js';
import { ACTIVE_BOOKING_STATUSES } from './transitions.js';

export interface OccupiedSpan {
  stationId: string;
  startAt: Date;
  endAt: Date;
  renterId: string;
  renterBusiness: string;
  holdId: string | null;
  bookingId: string | null;
}

interface SpanRow {
  station_id: string;
  start_at: Date;
  end_at: Date;
  renter_id: string;
  business: string;
  hold_id: string | null;
  booking_id: string | null;
}

/**
 * The one overlap rule: live holds and active bookings are half-open spans, so
 * back-to-back times that touch at a boundary do not overlap.
 */
export async function occupiedSpans(
  db: Db,
  stationIds: readonly string[],
  from: Date,
  to: Date,
  now: Date,
): Promise<OccupiedSpan[]> {
  const rows = await query<SpanRow>(
    db,
    `SELECT h.station_id, o.start_at, o.end_at, h.renter_id, r.business,
            h.id AS hold_id, NULL::text AS booking_id
       FROM hold_occurrences o
       JOIN holds h ON h.id = o.hold_id
       JOIN renters r ON r.id = h.renter_id
      WHERE h.station_id = ANY($1::text[]) AND h.status = 'held' AND h.expires_at > $4
        AND o.start_at < $3 AND o.end_at > $2
      UNION ALL
     SELECT b.station_id, b.start_at, b.end_at, b.renter_id, r.business,
            NULL::text AS hold_id, b.id AS booking_id
       FROM bookings b
       JOIN renters r ON r.id = b.renter_id
      WHERE b.station_id = ANY($1::text[]) AND b.status = ANY($5::text[])
        AND b.start_at < $3 AND b.end_at > $2
      ORDER BY start_at, end_at`,
    [stationIds, from, to, now, ACTIVE_BOOKING_STATUSES],
  );
  return rows.map((row) => ({
    stationId: row.station_id,
    startAt: row.start_at,
    endAt: row.end_at,
    renterId: row.renter_id,
    renterBusiness: row.business,
    holdId: row.hold_id,
    bookingId: row.booking_id,
  }));
}

export async function findBlocker(
  db: Db,
  stationId: string,
  from: Date,
  to: Date,
  now: Date,
): Promise<OccupiedSpan | null> {
  const spans = await occupiedSpans(db, [stationId], from, to, now);
  return spans[0] ?? null;
}

export function spanState(span: OccupiedSpan, viewerRenterId: string | null): SegmentState {
  const mine = viewerRenterId !== null && span.renterId === viewerRenterId;
  if (span.holdId !== null) return mine ? 'yours_held' : 'held';
  return mine ? 'yours_booked' : 'booked';
}
