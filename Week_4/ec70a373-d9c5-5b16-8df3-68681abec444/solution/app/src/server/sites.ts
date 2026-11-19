// Sites with their own clocks, and station availability for one site-local date.
import { pool, rows } from "./db.ts";
import { now } from "./clock.ts";
import { json, type AuthedCtx, type Reply } from "./router.ts";
import { Fields } from "./validate.ts";
import { siteFor } from "./scope.ts";
import { settleExpiredHolds } from "./bookings.ts";
import { addDays, formatWall, localNow, localToUtc, nonexistentSpans, wallClock, wallOn } from "../shared/time.ts";
import { occupiesStation, type StationKind } from "../shared/rules.ts";
import type { BookingStatus, Sector, SectorKind } from "../shared/api.ts";

// GET /api/sites
export async function listSites(ctx: AuthedCtx): Promise<Reply> {
  const user = ctx.user;
  const list = await rows<{ id: string; name: string; time_zone: string; address: string }>(
    pool,
    `SELECT id, name, time_zone, address FROM sites WHERE tenant_id = $1 ${user.role === "kitchen_manager" ? "AND id = $2" : ""} ORDER BY position`,
    user.role === "kitchen_manager" ? [user.tenantId, user.siteId] : [user.tenantId],
  );
  const at = now();
  return json(200, {
    sites: list.map((s) => ({
      id: s.id,
      name: s.name,
      time_zone: s.time_zone,
      address: s.address,
      local_now: localNow(at, s.time_zone),
      local_date: wallClock(at, s.time_zone).date,
    })),
  });
}

interface OccupyingRow {
  id: string;
  station_id: string;
  member_id: string;
  date: string;
  start_minutes: number;
  end_minutes: number;
  end_at: Date;
  occupied_until: Date;
  status: BookingStatus;
  hold_expires_at: Date | null;
}

// GET /api/sites/{site_id}/availability?date=
export async function availability(ctx: AuthedCtx): Promise<Reply> {
  const user = ctx.user;
  const site = await siteFor(pool, user, ctx.params.site_id);
  const fields = new Fields({ date: ctx.query.get("date") }, ["date"]);
  const date = fields.date("date");
  if (date === undefined) return fields.reject();
  const at = await settleExpiredHolds({ siteId: site.id });
  const dayStart = localToUtc(date, 0, site.time_zone);
  const dayEnd = localToUtc(addDays(date, 1), 0, site.time_zone);
  const stations = await rows<{ id: string; name: string; kind: StationKind }>(
    pool,
    "SELECT id, name, kind FROM stations WHERE site_id = $1 ORDER BY position",
    [site.id],
  );
  const occupying = (await rows<OccupyingRow>(
    pool,
    `SELECT b.id, b.station_id, b.member_id, b.date, b.start_minutes, b.end_minutes, b.end_at, b.occupied_until, b.status, b.hold_expires_at
       FROM bookings b
      WHERE b.site_id = $1 AND b.start_at < $3 AND b.occupied_until > $2
        AND b.status IN ('held', 'confirmed', 'checked_in')`,
    [site.id, new Date(dayStart), new Date(dayEnd)],
  )).filter((b) => occupiesStation(b.status, b.hold_expires_at?.getTime() ?? null, at));
  const missing = nonexistentSpans(date, site.time_zone);
  const own = (b: OccupyingRow): boolean => user.role === "member" && b.member_id === user.memberId;
  const kindOf = (b: OccupyingRow): SectorKind => (own(b) ? (b.status === "held" ? "own_held" : "own_confirmed") : "booked");
  const sector = (kind: SectorKind, start: number, end: number, bookingId: string | null): Sector => ({
    kind,
    start: formatWall(start),
    end: formatWall(end),
    booking_id: bookingId,
  });
  return json(200, {
    site_id: site.id,
    date,
    stations: stations.map((station) => {
      const sectors: Sector[] = missing.map((span) => sector("nonexistent", span.start, span.end, null));
      for (const b of occupying.filter((o) => o.station_id === station.id)) {
        const shownId = own(b) || user.role === "kitchen_manager" ? b.id : null;
        if (b.date === date) sectors.push(sector(kindOf(b), b.start_minutes, b.end_minutes, shownId));
        const bufferStart = wallOn(date, b.end_at.getTime(), site.time_zone);
        const bufferEnd = wallOn(date, b.occupied_until.getTime(), site.time_zone);
        if (bufferStart < bufferEnd) sectors.push(sector("buffer", bufferStart, bufferEnd, shownId));
      }
      sectors.sort((a, b) => (a.start === b.start ? a.end.localeCompare(b.end) : a.start.localeCompare(b.start)));
      return { id: station.id, name: station.name, kind: station.kind, sectors };
    }),
  });
}
