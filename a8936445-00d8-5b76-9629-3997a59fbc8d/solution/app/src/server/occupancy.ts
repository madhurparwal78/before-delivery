// What occupies each station on a kitchen day: live holds and confirmed, checked-in or completed bookings.
import { rows, type Queryable } from "./db";
import { BOOKING_SELECT, type BookingRow } from "./records";
import { occupiesStation } from "./rules";

export interface OccupyingBooking extends BookingRow {
  hold_expires_at: Date;
  hold_confirmed_at: Date | null;
}

export async function occupying(db: Queryable, dates: string[], nowMs: number, stationId?: string): Promise<OccupyingBooking[]> {
  const found = await rows<OccupyingBooking>(
    db,
    `SELECT q.*, h.expires_at AS hold_expires_at, h.confirmed_at AS hold_confirmed_at
       FROM (${BOOKING_SELECT}) q JOIN holds h ON h.ref = q.hold_ref
      WHERE q.date = ANY($1::date[]) AND ($2::text IS NULL OR q.station_id = $2)
        AND q.status IN ('held', 'confirmed', 'checked_in', 'completed')
      ORDER BY q.start_minute`,
    [dates, stationId ?? null],
  );
  return found.filter((b) => occupiesStation(b.status, { confirmed_at: b.hold_confirmed_at, expires_at: b.hold_expires_at }, nowMs));
}
