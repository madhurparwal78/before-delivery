import { all, type Db } from "./db.js";
import { ACTIVE_BOOKING_STATUSES } from "./rules.js";

export interface Claim {
  kind: "hold" | "booking";
  hold_id: string | null;
  booking_id: string | null;
  site_id: string;
  station_id: string;
  renter_id: string;
  renter_business: string;
  start_at: Date;
  end_at: Date;
}

export interface ClaimScope { siteId?: string; stationIds?: string[] }

/**
 * Every live claim on station time overlapping [from, to): live holds (held and strictly before
 * expires_at) and bookings in an active status. Intervals are half-open, so touching claims do not
 * overlap. This is the one overlap test in the app: hold placement, weekly repeats and contested
 * claims, the day dial, utilisation, dashboard totals and binders all read it.
 */
export async function liveClaims(db: Db, scope: ClaimScope, from: Date, to: Date, now: Date): Promise<Claim[]> {
  return all<Claim>(db, `
    SELECT * FROM (
      SELECT 'hold' AS kind, h.id AS hold_id, NULL::text AS booking_id, h.site_id, h.station_id, h.renter_id,
             r.business AS renter_business, o.start_at, o.end_at
        FROM hold_occurrences o JOIN holds h ON h.id = o.hold_id JOIN renters r ON r.id = h.renter_id
       WHERE h.status = 'held' AND h.expires_at > $3
      UNION ALL
      SELECT 'booking', b.hold_id, b.id, b.site_id, b.station_id, b.renter_id, r.business, b.start_at, b.end_at
        FROM bookings b JOIN renters r ON r.id = b.renter_id
       WHERE b.status = ANY($4::text[])
    ) claims
    WHERE start_at < $2 AND $1 < end_at
      AND ($5::text IS NULL OR site_id = $5)
      AND ($6::text[] IS NULL OR station_id = ANY($6::text[]))
    ORDER BY start_at, station_id`,
    [from, to, now, ACTIVE_BOOKING_STATUSES, scope.siteId ?? null, scope.stationIds ?? null]);
}

/** Minutes of a claim inside [from, to). */
export function overlapMinutes(claim: Claim, from: Date, to: Date): number {
  const start = Math.max(claim.start_at.getTime(), from.getTime());
  const end = Math.min(claim.end_at.getTime(), to.getTime());
  return Math.max(0, Math.round((end - start) / 60000));
}
