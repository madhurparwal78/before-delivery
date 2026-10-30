import type { DaySegment, DayStation, Site } from '../../shared/types.js';
import { pool, query } from '../db/pool.js';
import { segmentLabel } from '../domain/format.js';
import { occupiedSpans, spanState } from '../domain/occupancy.js';
import { packBalances } from '../domain/pack.js';
import { policyVersionAt, siteInScope, stationsOfSite } from '../domain/records.js';
import {
  addDays,
  dayTicks,
  isDateString,
  localDayMinutes,
  startOfLocalDay,
} from '../domain/zone.js';
import { json, type Reply } from '../http/context.js';
import { validation } from '../http/errors.js';
import type { Route } from '../http/router.js';

interface SiteRecord {
  id: string;
  name: string;
  time_zone: string;
  deposit_cents: number;
  cleaning_fee_cents: number;
}

interface StationRecord {
  id: string;
  site_id: string;
  name: string;
  rate_cents: number;
}

export const siteRoutes: Route[] = [
  {
    method: 'GET',
    pattern: '/api/sites',
    handle: async (ctx): Promise<Reply> => {
      const actor = ctx.requireActor();
      const sites = await query<SiteRecord>(
        pool,
        `SELECT id, name, time_zone, deposit_cents, cleaning_fee_cents FROM sites
          WHERE id = ANY($1::text[]) ORDER BY sort_order`,
        [actor.site_ids],
      );
      const stations = await query<StationRecord>(
        pool,
        `SELECT id, site_id, name, rate_cents FROM stations
          WHERE site_id = ANY($1::text[]) ORDER BY sort_order`,
        [actor.site_ids],
      );
      const now = new Date();
      const notices = new Map<string, number>();
      for (const site of sites) {
        notices.set(site.id, (await policyVersionAt(pool, site.id, now)).notice_hours);
      }
      const payload: Site[] = sites.map((site) => ({
        id: site.id,
        name: site.name,
        time_zone: site.time_zone,
        deposit_cents: site.deposit_cents,
        cleaning_fee_cents: site.cleaning_fee_cents,
        policy_notice_hours: notices.get(site.id) ?? 0,
        stations: stations
          .filter((station) => station.site_id === site.id)
          .map((station) => ({ id: station.id, name: station.name, rate_cents: station.rate_cents })),
      }));
      return json(200, { sites: payload });
    },
  },
  {
    method: 'GET',
    pattern: '/api/sites/:site_id/day',
    handle: async (ctx): Promise<Reply> => {
      const actor = ctx.requireActor();
      const site = await siteInScope(actor, ctx.params.site_id as string);
      const date = ctx.queryValue('date');
      if (!isDateString(date)) throw validation({ date: 'Give a date as YYYY-MM-DD.' });
      const dayStart = startOfLocalDay(site.time_zone, date);
      const dayEnd = startOfLocalDay(site.time_zone, addDays(date, 1));
      const stations = await stationsOfSite(pool, site.id);
      const viewerRenterId = actor.role === 'renter' ? actor.renter_id : null;
      const spans = await occupiedSpans(
        pool,
        stations.map((station) => station.id),
        dayStart,
        dayEnd,
        new Date(),
      );
      const dayStations: DayStation[] = stations.map((station) => {
        const segments: DaySegment[] = spans
          .filter((span) => span.stationId === station.id)
          .map((span) => {
            const state = spanState(span, viewerRenterId);
            const mine = state === 'yours_booked' || state === 'yours_held';
            const staffView = actor.role !== 'renter';
            return {
              start_at: span.startAt.toISOString(),
              end_at: span.endAt.toISOString(),
              state,
              label: segmentLabel(state, site.time_zone, span.startAt, span.endAt),
              booking_id: staffView || mine ? span.bookingId : null,
              hold_id: staffView || mine ? span.holdId : null,
              renter_business: staffView ? span.renterBusiness : null,
            };
          });
        return {
          id: station.id,
          name: station.name,
          rate_cents: station.rate_cents,
          segments,
        };
      });
      const packMinutes =
        actor.renter_id === null ? null : (await packBalances(pool, actor.renter_id)).availableMinutes;
      return json(200, {
        site_id: site.id,
        date,
        time_zone: site.time_zone,
        hours: localDayMinutes(site.time_zone, date) / 60,
        ticks: dayTicks(site.time_zone, date),
        pack_minutes_available: packMinutes,
        stations: dayStations,
      });
    },
  },
];
