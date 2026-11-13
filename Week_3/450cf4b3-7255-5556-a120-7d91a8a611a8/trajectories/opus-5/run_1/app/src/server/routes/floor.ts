import { transactionNow, withTransaction } from '../db';
import { instantOfKitchenTime, kitchenIso } from '../kitchen-time';
import { COOLER_SHELF_IDS } from '../domain/stations';
import {
  coolerFreeCells,
  dateWindow,
  occupiedPeriods,
  stationMetrics,
} from '../domain/occupancy';
import { spanStatusFor } from '../domain/span';
import { unauthenticated } from '../http/errors';
import { readSpanQuery } from '../http/validate';
import { intervalView, loadStations, stationView } from '../views';
import type { Ctx, Reply, Route } from '../http/route';
import type { FloorResponse, Station } from '../../shared/types';

const floor: Route = {
  method: 'GET',
  pattern: '/api/floor',
  roles: ['owner', 'shift_lead', 'tenant'],
  handler: async (ctx: Ctx): Promise<Reply> => {
    const span = readSpanQuery(ctx);
    const user = ctx.user;
    if (user === null) throw unauthenticated();

    return withTransaction(async (client) => {
      const now = await transactionNow(client);
      const stations = await loadStations(client);
      const window = dateWindow(span.date);
      const periods = await occupiedPeriods(client, window.from, window.to, now);
      const spanStart = span.from === null ? null : instantOfKitchenTime(span.date, span.from);
      const spanEnd = span.to === null ? null : instantOfKitchenTime(span.date, span.to);

      const stationViews: Station[] = stations.map((station) => {
        const intervals = periods
          .filter((period) => period.stationId === station.id)
          .map((period) => intervalView(period, user.role, user.tenantId));
        const metrics =
          spanStart === null || spanEnd === null
            ? null
            : stationMetrics(periods, station.id, spanStart, spanEnd);
        return stationView(station, intervals, metrics);
      });

      const body: FloorResponse = {
        date: span.date,
        from: span.from,
        to: span.to,
        now: kitchenIso(now),
        spanStatus: spanStart === null ? null : spanStatusFor(spanStart, now),
        coolerFree: coolerFreeCells(periods, COOLER_SHELF_IDS, span.date),
        stations: stationViews,
      };
      return { status: 200, body };
    });
  },
};

export const floorRoutes: ReadonlyArray<Route> = [floor];
