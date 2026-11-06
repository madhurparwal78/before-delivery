import { findStation, type Queryable } from '../../domain/kitchen.js';
import {
  assertHoldLive,
  findHold,
  holdView,
  placeHold,
  releaseCells,
  resizeHold,
  type HoldRow,
} from '../../domain/holds.js';
import { requireMemberId, type RequestContext } from '../context.js';
import { invalidField, notFound } from '../errors.js';
import { route, type Route } from '../router.js';
import { requireClock, requireDate, requireString } from '../validate.js';

/** Holds belonging to another member are invisible, exactly as unknown ids are. */
export async function resolveOwnHold(ctx: RequestContext): Promise<HoldRow> {
  const hold = await findHold(ctx.app.db, ctx.req.params['id'] as string);
  if (hold === null) throw notFound();
  if (ctx.user?.role !== 'operator' && hold.member_id !== ctx.user?.member_id) throw notFound();
  return hold;
}

async function stationFor(db: Queryable, stationId: string) {
  const station = await findStation(db, stationId);
  if (station === null) throw invalidField('station_id', 'unknown');
  return station;
}

export const holdRoutes: Route[] = [
  route({
    method: 'POST',
    path: '/holds',
    roles: ['member'],
    handle: async (ctx) => {
      const memberId = requireMemberId(ctx);
      const stationId = requireString(ctx.body, 'station_id');
      const date = requireDate(ctx.body, 'date');
      const start = requireClock(ctx.body, 'start');
      const end = requireClock(ctx.body, 'end');
      const station = await stationFor(ctx.app.db, stationId);

      const hold = await ctx.app.db.transaction(async (client) =>
        placeHold(
          client,
          { memberId, station, date, startMinutes: start, endMinutes: end },
          ctx.now,
          ctx.today,
          ctx.app.config.timeZone,
          ctx.app.config.holdSeconds,
        ),
      );
      return {
        status: 201,
        body: {
          hold: await holdView(ctx.app.db, hold, station, ctx.now, ctx.app.config.timeZone),
        },
      };
    },
  }),

  route<HoldRow>({
    method: 'PATCH',
    path: '/holds/:id',
    roles: ['member'],
    resolve: resolveOwnHold,
    handle: async (ctx, hold) => {
      assertHoldLive(hold, ctx.now);
      const end = requireClock(ctx.body, 'end');
      const station = await stationFor(ctx.app.db, hold.station_id);

      const updated = await ctx.app.db.transaction(async (client) => {
        const current = await findHold(client, hold.id);
        if (current === null) throw notFound();
        assertHoldLive(current, ctx.now);
        return resizeHold(
          client,
          current,
          station,
          end,
          ctx.now,
          ctx.today,
          ctx.app.config.timeZone,
        );
      });
      return {
        status: 200,
        body: {
          hold: await holdView(ctx.app.db, updated, station, ctx.now, ctx.app.config.timeZone),
        },
      };
    },
  }),

  route<HoldRow>({
    method: 'DELETE',
    path: '/holds/:id',
    roles: ['member'],
    resolve: resolveOwnHold,
    handle: async (ctx, hold) => {
      await ctx.app.db.transaction(async (client) => {
        const current = await findHold(client, hold.id);
        if (current === null) throw notFound();
        assertHoldLive(current, ctx.now);
        await client.query(`UPDATE holds SET status = 'released' WHERE id = $1`, [current.id]);
        await releaseCells(client, current.id);
      });
      return { status: 204 };
    },
  }),
];
