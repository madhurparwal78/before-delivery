import { Router } from 'express';
import type { BookingState } from '../../../shared/types.js';
import { formatMoney } from '../../../shared/format.js';
import { pool, withTransaction } from '../../db/pool.js';
import {
  bookingView,
  bookingViews,
  canTransition,
  loadBooking,
  loadBookingCells,
  loadBookingForUpdate,
  loadBookingLines,
  loadBookings,
  recordStateChange,
} from '../../domain/bookings.js';
import { cancelBookingUnit, type ConfirmContext } from '../../domain/confirming.js';
import {
  cardInForce,
  loadKitchen,
  loadMember,
  loadRateCards,
  loadStations,
  stationMap,
} from '../../domain/kitchens.js';
import { isValidDate, kitchenToday } from '../../domain/time.js';
import { requireRole, requireUser } from '../access.js';
import { ok, param, route } from '../context.js';
import { failures } from '../errors.js';

export const bookingRoutes = Router();

bookingRoutes.get(
  '/bookings',
  route(async (ctx) => {
    const user = requireUser(ctx.user);
    const stations = stationMap(await loadStations(pool, user.kitchen_id));
    const date = ctx.req.query.date;
    if (date !== undefined && !isValidDate(date)) {
      throw failures.validation({ date: 'Give a kitchen date as YYYY-MM-DD.' });
    }
    const filter: { kitchenId: string; memberId?: string; date?: string } = {
      kitchenId: user.kitchen_id,
    };
    if (user.role === 'member' && user.member_id !== null) filter.memberId = user.member_id;
    if (typeof date === 'string') filter.date = date;
    const rows = await loadBookings(pool, filter);
    return ok({ bookings: await bookingViews(pool, rows, stations) });
  }),
);

bookingRoutes.get(
  '/bookings/:booking_id',
  route(async (ctx) => {
    const user = requireUser(ctx.user);
    const row = await loadBooking(pool, param(ctx.req, 'booking_id'));
    if (!row || row.kitchen_id !== user.kitchen_id) throw failures.notFound();
    if (user.role === 'member' && row.member_id !== user.member_id) throw failures.notFound();
    const stations = stationMap(await loadStations(pool, user.kitchen_id));
    const cells = await loadBookingCells(pool, row.id);
    const lines = await loadBookingLines(pool, [row.id]);
    return ok({ booking: bookingView(row, cells, lines, stations) });
  }),
);

bookingRoutes.post(
  '/bookings/:booking_id/cancel',
  route(async (ctx) => {
    const user = requireUser(ctx.user);
    const row = await loadBooking(pool, param(ctx.req, 'booking_id'));
    if (!row || row.kitchen_id !== user.kitchen_id) throw failures.notFound();
    if (user.role === 'member' && row.member_id !== user.member_id) throw failures.notFound();
    requireRole(user, 'operator', 'member');

    const kitchen = await loadKitchen(pool, row.kitchen_id);
    const member = await loadMember(pool, row.member_id);
    if (!kitchen || !member) throw failures.notFound();
    const stations = await loadStations(pool, kitchen.id);
    const today = kitchenToday(kitchen.timezone, ctx.now);
    const rateCard = cardInForce(await loadRateCards(pool, kitchen.id), today);
    if (!rateCard) throw failures.notFound();

    const context: ConfirmContext = {
      kitchen,
      member,
      stations,
      stationsById: stationMap(stations),
      rateCard,
      actorId: user.id,
      now: ctx.now,
    };
    const outcome = await cancelBookingUnit(context, row.id);
    return ok({
      booking: outcome.booking,
      refund: {
        pack_quarters: outcome.refund.pack_quarters,
        amount_cents: outcome.refund.amount_cents,
        amount: formatMoney(outcome.refund.amount_cents),
      },
    });
  }),
);

function dayStepRoute(target: BookingState, requiresBookingDay: boolean) {
  return route(async (ctx) => {
    const user = requireUser(ctx.user);
    const row = await loadBooking(pool, param(ctx.req, 'booking_id'));
    if (!row || row.kitchen_id !== user.kitchen_id) throw failures.notFound();
    requireRole(user, 'operator');
    const kitchen = await loadKitchen(pool, row.kitchen_id);
    if (!kitchen) throw failures.notFound();
    const today = kitchenToday(kitchen.timezone, ctx.now);

    const stations = stationMap(await loadStations(pool, kitchen.id));
    const updated = await withTransaction(async (client) => {
      const fresh = await loadBookingForUpdate(client, row.id);
      if (!fresh) throw failures.notFound();
      if (!canTransition(fresh.state, target)) {
        throw failures.invalidTransition(fresh.state, target);
      }
      if (requiresBookingDay && today < fresh.date) throw failures.bookingDayNotReached();
      await client.query('UPDATE bookings SET state = $2 WHERE id = $1', [fresh.id, target]);
      await recordStateChange(client, {
        actorId: user.id,
        kitchenId: kitchen.id,
        subject: 'booking',
        subjectId: fresh.id,
        from: fresh.state,
        to: target,
        now: ctx.now,
      });
      return { ...fresh, state: target };
    });

    const cells = await loadBookingCells(pool, row.id);
    const lines = await loadBookingLines(pool, [row.id]);
    return ok({ booking: bookingView(updated, cells, lines, stations) });
  });
}

bookingRoutes.post('/bookings/:booking_id/check-in', dayStepRoute('checked_in', true));
bookingRoutes.post('/bookings/:booking_id/complete', dayStepRoute('completed', false));
bookingRoutes.post('/bookings/:booking_id/no-show', dayStepRoute('no_show', true));
