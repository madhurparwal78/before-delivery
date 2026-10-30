import type { DashboardSite } from '../../shared/types.js';
import { pool, query } from '../db/pool.js';
import { siteInScope, stationsOfSite } from '../domain/records.js';
import { ACTIVE_BOOKING_STATUSES } from '../domain/transitions.js';
import {
  addDays,
  isDateString,
  localDate,
  localDayMinutes,
  startOfLocalDay,
} from '../domain/zone.js';
import { json, type Ctx, type Reply } from '../http/context.js';
import { validation } from '../http/errors.js';
import type { Route } from '../http/router.js';

interface SpanRow {
  station_id: string;
  start_at: Date;
  end_at: Date;
}

function clippedMinutes(span: SpanRow, from: Date, to: Date): number {
  const start = Math.max(span.start_at.getTime(), from.getTime());
  const end = Math.min(span.end_at.getTime(), to.getTime());
  return Math.max(0, Math.round((end - start) / 60_000));
}

function roundToOneDecimal(value: number): number {
  return Math.floor(value * 10 + 0.5) / 10;
}

async function bookedSpans(siteId: string, from: Date, to: Date): Promise<SpanRow[]> {
  return query<SpanRow>(
    pool,
    `SELECT station_id, start_at, end_at FROM bookings
      WHERE site_id = $1 AND status = ANY($2::text[]) AND start_at < $4 AND end_at > $3`,
    [siteId, ACTIVE_BOOKING_STATUSES, from, to],
  );
}

async function utilisationFor(
  siteId: string,
  timeZone: string,
  date: string,
): Promise<{ dayMinutes: number; stations: { station_id: string; name: string; booked_minutes: number; utilisation_percent: number }[] }> {
  const dayStart = startOfLocalDay(timeZone, date);
  const dayEnd = startOfLocalDay(timeZone, addDays(date, 1));
  const dayMinutes = localDayMinutes(timeZone, date);
  const stations = await stationsOfSite(pool, siteId);
  const spans = await bookedSpans(siteId, dayStart, dayEnd);
  return {
    dayMinutes,
    stations: stations.map((station) => {
      const booked = spans
        .filter((span) => span.station_id === station.id)
        .reduce((sum, span) => sum + clippedMinutes(span, dayStart, dayEnd), 0);
      return {
        station_id: station.id,
        name: station.name,
        booked_minutes: booked,
        utilisation_percent: roundToOneDecimal((booked / dayMinutes) * 100),
      };
    }),
  };
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

async function dashboard(ctx: Ctx): Promise<Reply> {
  const actor = ctx.requireRole('manager');
  const sites = await query<{ id: string; name: string; time_zone: string }>(
    pool,
    `SELECT id, name, time_zone FROM sites WHERE id = ANY($1::text[]) ORDER BY sort_order`,
    [actor.site_ids],
  );
  const payload: DashboardSite[] = [];
  for (const site of sites) {
    const today = localDate(site.time_zone, new Date());
    const dayStart = startOfLocalDay(site.time_zone, today);
    const dayEnd = startOfLocalDay(site.time_zone, addDays(today, 1));
    const spans = await bookedSpans(site.id, dayStart, dayEnd);
    const unpaid = await query<{ card_cents: number }>(
      pool,
      `SELECT b.card_cents FROM bookings b
        WHERE b.site_id = $1 AND b.status = 'confirmed' AND b.time_paid = false AND b.card_minutes > 0
          AND (b.start_at AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date`,
      [site.id, site.time_zone, today, addDays(today, 30)],
    );
    const documents = await query<{ count: string }>(
      pool,
      `SELECT COUNT(*)::text AS count FROM documents d
         JOIN renters r ON r.id = d.renter_id
        WHERE r.home_site_id = $1 AND d.expires_on BETWEEN $2::date AND $3::date`,
      [site.id, today, addDays(today, 14)],
    );
    payload.push({
      site_id: site.id,
      name: site.name,
      local_date: today,
      bookings_today: spans.length,
      booked_minutes_today: spans.reduce(
        (sum, span) => sum + clippedMinutes(span, dayStart, dayEnd),
        0,
      ),
      unpaid_balance_cents: unpaid.reduce((sum, row) => sum + row.card_cents, 0),
      expiring_documents: Number(documents[0]?.count ?? 0),
    });
  }
  return json(200, {
    sites: payload,
    totals: {
      bookings_today: payload.reduce((sum, site) => sum + site.bookings_today, 0),
      booked_minutes_today: payload.reduce((sum, site) => sum + site.booked_minutes_today, 0),
      unpaid_balance_cents: payload.reduce((sum, site) => sum + site.unpaid_balance_cents, 0),
      expiring_documents: payload.reduce((sum, site) => sum + site.expiring_documents, 0),
    },
  });
}

export const reportRoutes: Route[] = [
  { method: 'GET', pattern: '/api/dashboard', handle: dashboard },
  {
    method: 'GET',
    pattern: '/api/sites/:id/utilisation',
    handle: async (ctx): Promise<Reply> => {
      const actor = ctx.requireActor();
      const site = await siteInScope(actor, ctx.params.id as string);
      ctx.requireRole('manager');
      const date = ctx.queryValue('date');
      if (!isDateString(date)) throw validation({ date: 'Give a date as YYYY-MM-DD.' });
      const report = await utilisationFor(site.id, site.time_zone, date);
      return json(200, {
        site_id: site.id,
        date,
        time_zone: site.time_zone,
        day_minutes: report.dayMinutes,
        stations: report.stations,
      });
    },
  },
  {
    method: 'GET',
    pattern: '/api/sites/:id/utilisation.csv',
    handle: async (ctx): Promise<Reply> => {
      const actor = ctx.requireActor();
      const site = await siteInScope(actor, ctx.params.id as string);
      ctx.requireRole('manager');
      const date = ctx.queryValue('date');
      if (!isDateString(date)) throw validation({ date: 'Give a date as YYYY-MM-DD.' });
      const report = await utilisationFor(site.id, site.time_zone, date);
      const lines = ['station,booked_minutes,day_minutes,utilisation_percent'];
      for (const station of report.stations) {
        lines.push(
          [
            csvCell(station.name),
            String(station.booked_minutes),
            String(report.dayMinutes),
            station.utilisation_percent.toFixed(1),
          ].join(','),
        );
      }
      return {
        status: 200,
        bytes: Buffer.from(`${lines.join('\n')}\n`, 'utf8'),
        contentType: 'text/csv; charset=utf-8',
        headers: {
          'content-disposition': `attachment; filename="utilisation-${site.id}-${date}.csv"`,
        },
      };
    },
  },
];
