import type { Binder, BinderRow } from '../../shared/types.js';
import { query, queryOne, type Db } from '../db/pool.js';
import { documentStatusOn, readableDocuments } from './compliance.js';
import { ACTIVE_BOOKING_STATUSES } from './transitions.js';
import { addDays, datesTouched, localStamp, startOfLocalDay } from './zone.js';

interface BinderBookingRow {
  renter_id: string;
  renter_name: string;
  business: string;
  station_name: string;
  start_at: Date;
  end_at: Date;
}

export interface BinderSource {
  siteId: string;
  from: string;
  to: string;
  generatedAt: Date;
}

/** The binder lists only this site's scheduled bookings, with no contact or money data. */
export async function buildBinder(db: Db, source: BinderSource): Promise<Binder> {
  const site = await queryOne<{ name: string; time_zone: string }>(
    db,
    'SELECT name, time_zone FROM sites WHERE id = $1',
    [source.siteId],
  );
  if (site === null) throw new Error(`unknown site ${source.siteId}`);
  const rangeStart = startOfLocalDay(site.time_zone, source.from);
  const rangeEnd = startOfLocalDay(site.time_zone, addDays(source.to, 1));
  const bookings = await query<BinderBookingRow>(
    db,
    `SELECT b.renter_id, r.name AS renter_name, r.business, st.name AS station_name, b.start_at, b.end_at
       FROM bookings b
       JOIN renters r ON r.id = b.renter_id
       JOIN stations st ON st.id = b.station_id
      WHERE b.site_id = $1 AND b.status = ANY($2::text[]) AND b.start_at < $4 AND b.end_at > $3
      ORDER BY b.start_at, r.business`,
    [source.siteId, ACTIVE_BOOKING_STATUSES, rangeStart, rangeEnd],
  );
  const renterIds = [...new Set(bookings.map((booking) => booking.renter_id))];
  const documents = renterIds.length === 0 ? [] : await readableDocuments(db, renterIds);
  const rows: BinderRow[] = [];
  for (const booking of bookings) {
    const dates = datesTouched(site.time_zone, booking.start_at, booking.end_at).filter(
      (date) => date >= source.from && date <= source.to,
    );
    const renterDocuments = documents.filter((document) => document.renter_id === booking.renter_id);
    for (const date of dates) {
      rows.push({
        date,
        renter_name: booking.renter_name,
        business: booking.business,
        station: booking.station_name,
        local_start: localStamp(site.time_zone, booking.start_at),
        local_end: localStamp(site.time_zone, booking.end_at),
        liability: documentStatusOn(renterDocuments, 'liability', date),
        food_handler: documentStatusOn(renterDocuments, 'food_handler', date),
      });
    }
  }
  rows.sort((left, right) =>
    left.date === right.date
      ? left.local_start.localeCompare(right.local_start)
      : left.date.localeCompare(right.date),
  );
  return {
    site_name: site.name,
    from: source.from,
    to: source.to,
    generated_at: source.generatedAt.toISOString(),
    rows,
  };
}
