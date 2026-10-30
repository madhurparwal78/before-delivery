import { requireActor } from "../auth.js";
import { liveClaims } from "../claims.js";
import { all, pool } from "../db.js";
import { invalid, json, route } from "../http.js";
import { packBalance } from "../ledger.js";
import { segmentLabel, segmentState } from "../rules.js";
import { siteInScope, siteVisible, type SiteRow, type StationRow } from "../scope.js";
import { addMinutes, isLocalDate, localDay, localTime, zoneAbbreviation } from "../time.js";

route("GET", "/api/sites", async (request) => {
  const actor = await requireActor(request);
  const sites = (await all<SiteRow>(pool, "SELECT * FROM sites ORDER BY position")).filter((site) => siteVisible(actor, site));
  const stations = await all<StationRow>(pool, "SELECT * FROM stations ORDER BY position");
  return json(200, {
    sites: sites.map((site) => ({
      id: site.id, name: site.name, time_zone: site.time_zone, deposit_cents: site.deposit_cents, cleaning_fee_cents: site.cleaning_fee_cents,
      stations: stations.filter((station) => station.site_id === site.id).map((station) => ({ id: station.id, name: station.name, rate_cents: station.rate_cents })),
    })),
  });
});

route("GET", "/api/sites/:site_id/day", async (request) => {
  const actor = await requireActor(request);
  const site = await siteInScope(pool, actor, request.params.site_id ?? "");
  const date = request.query.get("date");
  if (!isLocalDate(date)) throw invalid({ date: "Use a date in the form YYYY-MM-DD." });
  const now = new Date();
  const zone = site.time_zone;
  const day = localDay(zone, date);
  const ticks = [];
  for (let at = day.start; at < day.end; at = addMinutes(at, 60)) ticks.push({ at: at.toISOString(), label: localTime(zone, at), zone: zoneAbbreviation(zone, at) });
  const stations = await all<StationRow>(pool, "SELECT * FROM stations WHERE site_id = $1 ORDER BY position", [site.id]);
  const claims = await liveClaims(pool, { siteId: site.id }, day.start, day.end, now);
  const staff = actor.role !== "renter";
  return json(200, {
    site_id: site.id, date, time_zone: zone, hours: day.minutes / 60, ticks,
    pack_minutes_available: actor.renterId ? (await packBalance(pool, actor.renterId)).available : null,
    stations: stations.map((station) => ({
      id: station.id, name: station.name, rate_cents: station.rate_cents,
      segments: claims.filter((claim) => claim.station_id === station.id).map((claim) => {
        const mine = !staff && claim.renter_id === actor.renterId;
        const state = segmentState(claim.kind, mine);
        return {
          start_at: claim.start_at.toISOString(), end_at: claim.end_at.toISOString(), state,
          label: segmentLabel(state, zone, claim.start_at, claim.end_at),
          booking_id: staff || mine ? claim.booking_id : null,
          hold_id: claim.kind === "hold" && (staff || mine) ? claim.hold_id : null,
          renter_business: staff ? claim.renter_business : null,
        };
      }),
    })),
  });
});
