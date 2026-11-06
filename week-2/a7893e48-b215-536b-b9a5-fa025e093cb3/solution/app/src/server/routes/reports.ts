import { requireActor, requireRole } from "../auth.js";
import { liveClaims, overlapMinutes } from "../claims.js";
import { all, one, pool } from "../db.js";
import { invalid, json, route, type ApiRequest } from "../http.js";
import { siteInScope, siteVisible, type BookingRow, type SiteRow, type StationRow } from "../scope.js";
import { addDays, isLocalDate, localDate, localDay } from "../time.js";
import { balanceDue } from "../views.js";

route("GET", "/api/dashboard", async (request) => {
  const actor = await requireActor(request);
  requireRole(actor, "manager");
  const now = new Date();
  const sites = (await all<SiteRow>(pool, "SELECT * FROM sites ORDER BY position")).filter((site) => siteVisible(actor, site));
  const rows: { site_id: string; name: string; local_date: string; bookings_today: number; booked_minutes_today: number; unpaid_balance_cents: number; expiring_documents: number }[] = [];
  for (const site of sites) {
    const today = localDate(site.time_zone, now);
    const day = localDay(site.time_zone, today);
    const booked = (await liveClaims(pool, { siteId: site.id }, day.start, day.end, now)).filter((claim) => claim.kind === "booking");
    const unpaid = (await all<BookingRow>(pool, "SELECT * FROM bookings WHERE site_id = $1 AND status = 'confirmed'", [site.id]))
      .filter((booking) => { const date = localDate(site.time_zone, booking.start_at); return date >= today && date <= addDays(today, 30); })
      .reduce((sum, booking) => sum + balanceDue(booking), 0);
    const expiring = await one<{ count: number }>(pool,
      `SELECT count(*)::int AS count FROM documents d JOIN renters r ON r.id = d.renter_id
        WHERE r.home_site_id = $1 AND d.expires_on >= $2 AND d.expires_on <= $3`, [site.id, today, addDays(today, 14)]);
    rows.push({
      site_id: site.id, name: site.name, local_date: today, bookings_today: booked.length,
      booked_minutes_today: booked.reduce((sum, claim) => sum + overlapMinutes(claim, day.start, day.end), 0),
      unpaid_balance_cents: unpaid, expiring_documents: expiring?.count ?? 0,
    });
  }
  const sum = (key: "bookings_today" | "booked_minutes_today" | "unpaid_balance_cents" | "expiring_documents"): number => rows.reduce((total, row) => total + row[key], 0);
  return json(200, {
    sites: rows,
    totals: { bookings_today: sum("bookings_today"), booked_minutes_today: sum("booked_minutes_today"), unpaid_balance_cents: sum("unpaid_balance_cents"), expiring_documents: sum("expiring_documents") },
  });
});

interface Utilisation { site: SiteRow; date: string; dayMinutes: number; stations: { station: StationRow; booked: number; percent: number }[] }

/** Booked station minutes inside the site's local day of 23, 24 or 25 hours; percent rounded half-up to one decimal. */
async function utilisation(request: ApiRequest): Promise<Utilisation> {
  const actor = await requireActor(request);
  const site = await siteInScope(pool, actor, request.params.id ?? "");
  requireRole(actor, "manager");
  const date = request.query.get("date");
  if (!isLocalDate(date)) throw invalid({ date: "Use a date in the form YYYY-MM-DD." });
  const day = localDay(site.time_zone, date);
  const stations = await all<StationRow>(pool, "SELECT * FROM stations WHERE site_id = $1 ORDER BY position", [site.id]);
  const booked = (await liveClaims(pool, { siteId: site.id }, day.start, day.end, new Date())).filter((claim) => claim.kind === "booking");
  return {
    site, date, dayMinutes: day.minutes,
    stations: stations.map((station) => {
      const minutes = booked.filter((claim) => claim.station_id === station.id).reduce((sum, claim) => sum + overlapMinutes(claim, day.start, day.end), 0);
      return { station, booked: minutes, percent: Math.floor((2 * minutes * 1000 + day.minutes) / (2 * day.minutes)) / 10 };
    }),
  };
}

route("GET", "/api/sites/:id/utilisation", async (request) => {
  const report = await utilisation(request);
  return json(200, {
    site_id: report.site.id, date: report.date, time_zone: report.site.time_zone, day_minutes: report.dayMinutes,
    stations: report.stations.map((row) => ({ station_id: row.station.id, name: row.station.name, booked_minutes: row.booked, utilisation_percent: row.percent })),
  });
});

const FORMULA_START = /^[=+\-@\t\r]/;

/** One CSV cell: formula-looking text gets a leading quote, then RFC 4180 quoting (kit module csv_safe, adapted). */
function csvCell(value: string | number): string {
  let text = String(value);
  if (typeof value !== "number" && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

route("GET", "/api/sites/:id/utilisation.csv", async (request) => {
  const report = await utilisation(request);
  const lines = [["station", "booked_minutes", "day_minutes", "utilisation_percent"],
    ...report.stations.map((row) => [row.station.name, row.booked, report.dayMinutes, row.percent])];
  return {
    status: 200,
    raw: {
      data: lines.map((line) => line.map(csvCell).join(",")).join("\r\n") + "\r\n", type: "text/csv; charset=utf-8",
      headers: { "Content-Disposition": `attachment; filename="utilisation-${report.site.id}-${report.date}.csv"`, "Cache-Control": "no-store" },
    },
  };
});
