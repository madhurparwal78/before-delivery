import type { KitchenInfo } from '../../../shared/api.js';
import {
  BOOKING_DAYS_AHEAD,
  CHECK_IN_OPENS_MINUTES,
  FREE_CANCEL_DAYS,
} from '../../../shared/domain.js';
import {
  BOARD_CLOSES_MINUTES,
  BOARD_OPENS_MINUTES,
  MINUTES_PER_CELL,
  formatClock,
  formatInstant,
} from '../../../shared/time.js';
import { KITCHEN_NAME } from '../../db/seed.js';
import { buildBoard } from '../../domain/board.js';
import { listPacks, listStations, packView, stationView } from '../../domain/kitchen.js';
import { requireUser } from '../context.js';
import { route, type Route } from '../router.js';
import { queryDate } from '../validate.js';

export const kitchenRoutes: Route[] = [
  route({
    method: 'GET',
    path: '/kitchen',
    handle: async (ctx) => {
      const info: KitchenInfo = {
        name: KITCHEN_NAME,
        time_zone: ctx.app.config.timeZone,
        now: formatInstant(ctx.now, ctx.app.config.timeZone),
        today: ctx.today,
        hold_seconds: ctx.app.config.holdSeconds,
        free_cancel_days: FREE_CANCEL_DAYS,
        check_in_opens_minutes: CHECK_IN_OPENS_MINUTES,
        booking_days_ahead: BOOKING_DAYS_AHEAD,
        board: {
          opens: formatClock(BOARD_OPENS_MINUTES),
          closes: formatClock(BOARD_CLOSES_MINUTES),
          cell_minutes: MINUTES_PER_CELL,
        },
        stations: (await listStations(ctx.app.db)).map(stationView),
        packs: (await listPacks(ctx.app.db)).map(packView),
        billing: ctx.app.billing.state,
      };
      return { status: 200, body: info };
    },
  }),

  route({
    method: 'GET',
    path: '/board',
    handle: async (ctx) => {
      const user = requireUser(ctx);
      const date = queryDate(ctx.req.query['date'], 'date', ctx.today);
      const stations = await buildBoard(
        ctx.app.db,
        date,
        user,
        ctx.now,
        ctx.app.config.timeZone,
      );
      return {
        status: 200,
        body: {
          date,
          today: ctx.today,
          now: formatInstant(ctx.now, ctx.app.config.timeZone),
          time_zone: ctx.app.config.timeZone,
          billing: ctx.app.billing.state,
          stations,
        },
      };
    },
  }),
];
