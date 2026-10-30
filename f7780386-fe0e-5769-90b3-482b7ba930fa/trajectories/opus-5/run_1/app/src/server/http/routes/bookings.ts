import { BOOKINGS_MAX_RANGE_DAYS } from '../../../shared/domain.js';
import { addDays, daysBetween, isValidDate } from '../../../shared/time.js';
import {
  BOOKING_SELECT,
  bookingViewOf,
  bookingViews,
  cancelBooking,
  checkIn,
  confirmHold,
  findBooking,
  waiveFee,
  type BookingRow,
} from '../../domain/bookings.js';
import { requireUser, type RequestContext } from '../context.js';
import { notFound, validationFailed } from '../errors.js';
import { route, type Route } from '../router.js';
import { queryDate, queryString } from '../validate.js';
import { resolveOwnHold } from './holds.js';

/** Bookings outside the caller's scope answer 404, exactly as unknown ids do. */
async function resolveVisibleBooking(ctx: RequestContext): Promise<BookingRow> {
  const booking = await findBooking(ctx.app.db, ctx.req.params['id'] as string);
  if (booking === null) throw notFound();
  const user = requireUser(ctx);
  if (user.role !== 'operator' && booking.member_id !== user.member_id) throw notFound();
  return booking;
}

export const bookingRoutes: Route[] = [
  route({
    method: 'POST',
    path: '/holds/:id/confirm',
    roles: ['member'],
    resolve: resolveOwnHold,
    handle: async (ctx, hold) => {
      const booking = await confirmHold(ctx.app, hold.id, ctx.now, ctx.app.config.timeZone);
      return {
        status: 201,
        body: {
          booking: await bookingViewOf(ctx.app.db, booking, ctx.now, ctx.app.config.timeZone),
        },
      };
    },
  }),

  route({
    method: 'GET',
    path: '/bookings',
    handle: async (ctx) => {
      const user = requireUser(ctx);
      const from = queryDate(ctx.req.query['from'], 'from', ctx.today);
      const rawTo = queryString(ctx.req.query['to']);
      if (rawTo !== null && !isValidDate(rawTo)) throw validationFailed({ to: 'invalid' });
      const to = rawTo ?? addDays(from, 28);
      if (daysBetween(from, to) + 1 > BOOKINGS_MAX_RANGE_DAYS) {
        throw validationFailed({ to: 'range_too_long' });
      }

      const conditions = ['b.kitchen_date BETWEEN $1::date AND $2::date'];
      const params: unknown[] = [from, to];
      if (user.role === 'operator') {
        const memberId = queryString(ctx.req.query['member_id']);
        if (memberId !== null) {
          params.push(memberId);
          conditions.push(`b.member_id = $${params.length}`);
        }
      } else {
        params.push(user.member_id);
        conditions.push(`b.member_id = $${params.length}`);
      }

      const result = await ctx.app.db.query<BookingRow>(
        `${BOOKING_SELECT} WHERE ${conditions.join(' AND ')}
         ORDER BY b.kitchen_date, b.start_minutes, s.name`,
        params,
      );
      return {
        status: 200,
        body: {
          bookings: await bookingViews(
            ctx.app.db,
            result.rows,
            ctx.now,
            ctx.app.config.timeZone,
          ),
        },
      };
    },
  }),

  route<BookingRow>({
    method: 'GET',
    path: '/bookings/:id',
    resolve: resolveVisibleBooking,
    handle: async (ctx, booking) => ({
      status: 200,
      body: {
        booking: await bookingViewOf(ctx.app.db, booking, ctx.now, ctx.app.config.timeZone),
      },
    }),
  }),

  route<BookingRow>({
    method: 'POST',
    path: '/bookings/:id/cancel',
    roles: ['member', 'operator'],
    resolve: resolveVisibleBooking,
    handle: async (ctx, booking) => {
      const cancelled = await cancelBooking(ctx.app, booking.id, ctx.now);
      return {
        status: 200,
        body: {
          booking: await bookingViewOf(ctx.app.db, cancelled, ctx.now, ctx.app.config.timeZone),
        },
      };
    },
  }),

  route<BookingRow>({
    method: 'POST',
    path: '/bookings/:id/waive-fee',
    roles: ['operator'],
    resolve: resolveVisibleBooking,
    handle: async (ctx, booking) => {
      const waived = await waiveFee(ctx.app, booking.id, ctx.now);
      return {
        status: 200,
        body: {
          booking: await bookingViewOf(ctx.app.db, waived, ctx.now, ctx.app.config.timeZone),
        },
      };
    },
  }),

  route<BookingRow>({
    method: 'POST',
    path: '/bookings/:id/check-ins',
    roles: ['crew_cook'],
    resolve: resolveVisibleBooking,
    handle: async (ctx, booking) => {
      const user = requireUser(ctx);
      const result = await checkIn(
        ctx.app,
        booking.id,
        user.id,
        ctx.now,
        ctx.app.config.timeZone,
      );
      return {
        status: result.created ? 201 : 200,
        body: {
          check_in: result.checkIn,
          booking: await bookingViewOf(
            ctx.app.db,
            result.booking,
            ctx.now,
            ctx.app.config.timeZone,
          ),
        },
      };
    },
  }),
];
