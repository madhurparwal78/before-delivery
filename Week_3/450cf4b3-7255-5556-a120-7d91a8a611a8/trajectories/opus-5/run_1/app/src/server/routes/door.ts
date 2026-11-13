import { query, transactionNow, withTransaction, type Db } from '../db';
import { instantOfKitchenLocal, kitchenDate, kitchenIso } from '../kitchen-time';
import { serverMessage } from '../../shared/copy';
import {
  bookingById,
  bookingStanding,
  checkInOpensAtOf,
  lockBooking,
} from '../domain/bookings';
import { currentDocuments } from '../domain/documents';
import { clearanceFor, tenantById, tenantStanding } from '../domain/tenants';
import { conflict, notFound, unauthenticated } from '../http/errors';
import { finishValidation, readDateQuery } from '../http/validate';
import { bookingsStartingOn, loadBookingViews, loadDoorEntries } from '../views';
import type { Ctx, Reply, Route } from '../http/route';
import type { DoorAction, Role } from '../../shared/types';

async function bookingOr404(ctx: Ctx, client: Db): Promise<void> {
  const booking = await bookingById(client, ctx.params.id ?? '');
  if (booking === null) throw notFound();
}

async function appendDoorLog(
  client: Db,
  bookingId: string,
  action: DoorAction,
  userId: string,
  name: string,
  at: Date,
): Promise<void> {
  await query(
    client,
    'insert into door_log (booking_id, action, at, by_user_id, by_name) values ($1,$2,$3,$4,$5)',
    [bookingId, action, at, userId, name],
  );
}

async function replyWithBooking(client: Db, bookingId: string, role: Role, now: Date): Promise<Reply> {
  const booking = await bookingById(client, bookingId);
  if (booking === null) throw notFound();
  const views = await loadBookingViews(client, [booking], role, now);
  const view = views[0];
  if (view === undefined) throw notFound();
  return { status: 200, body: view };
}

const checkIn: Route = {
  method: 'POST',
  pattern: '/api/bookings/:id/check-in',
  roles: ['owner', 'shift_lead'],
  resolve: bookingOr404,
  handler: async (ctx: Ctx): Promise<Reply> => {
    const user = ctx.user;
    if (user === null) throw unauthenticated();
    return withTransaction(async (client) => {
      const now = await transactionNow(client);
      const booking = await lockBooking(client, ctx.params.id ?? '');
      if (booking === null) throw notFound();
      const standing = bookingStanding(booking, now);
      if (standing.status !== 'confirmed') {
        throw conflict('invalid_transition', serverMessage.invalidTransition);
      }
      const opensAt = checkInOpensAtOf(booking.start_at).getTime();
      if (now.getTime() < opensAt || now.getTime() >= booking.end_at.getTime()) {
        throw conflict('outside_check_in_window', serverMessage.outsideCheckInWindow);
      }
      const tenant = await tenantById(client, booking.tenant_id);
      if (tenant === null) throw notFound();
      const documents = await currentDocuments(client, tenant.id);
      const today = kitchenDate(now);
      const clearance = clearanceFor(tenantStanding(tenant, documents, today), documents, today);
      if (!clearance.cleared) throw conflict('not_cleared', serverMessage.notCleared);

      await query(client, `update bookings set status = 'checked_in' where id = $1`, [booking.id]);
      await appendDoorLog(client, booking.id, 'check_in', user.id, user.displayName, now);
      return replyWithBooking(client, booking.id, user.role, now);
    });
  },
};

const checkOut: Route = {
  method: 'POST',
  pattern: '/api/bookings/:id/check-out',
  roles: ['owner', 'shift_lead'],
  bodyFields: ['cleanupDone', 'note'],
  resolve: bookingOr404,
  handler: async (ctx: Ctx): Promise<Reply> => {
    const user = ctx.user;
    if (user === null) throw unauthenticated();
    const fields: Record<string, string> = {};
    const cleanupDone = ctx.body.cleanupDone;
    const note = ctx.body.note;
    if (cleanupDone !== true) fields.cleanupDone = serverMessage.cleanupBox;
    if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > 500)) {
      fields.note = serverMessage.noteTooLong;
    }
    finishValidation(ctx, fields);

    return withTransaction(async (client) => {
      const now = await transactionNow(client);
      const booking = await lockBooking(client, ctx.params.id ?? '');
      if (booking === null) throw notFound();
      const standing = bookingStanding(booking, now);
      if (standing.status !== 'checked_in') {
        throw conflict('invalid_transition', serverMessage.invalidTransition);
      }
      await query(client, `update bookings set status = 'completed', cleanup_note = $2 where id = $1`, [
        booking.id,
        typeof note === 'string' && note !== '' ? note : null,
      ]);
      await appendDoorLog(client, booking.id, 'check_out', user.id, user.displayName, now);
      return replyWithBooking(client, booking.id, user.role, now);
    });
  },
};

const noShow: Route = {
  method: 'POST',
  pattern: '/api/bookings/:id/no-show',
  roles: ['owner', 'shift_lead'],
  resolve: bookingOr404,
  handler: async (ctx: Ctx): Promise<Reply> => {
    const user = ctx.user;
    if (user === null) throw unauthenticated();
    return withTransaction(async (client) => {
      const now = await transactionNow(client);
      const booking = await lockBooking(client, ctx.params.id ?? '');
      if (booking === null) throw notFound();
      const standing = bookingStanding(booking, now);
      if (standing.status !== 'confirmed') {
        throw conflict('invalid_transition', serverMessage.invalidTransition);
      }
      if (now.getTime() < booking.start_at.getTime()) {
        throw conflict('too_early', serverMessage.tooEarly);
      }
      await query(client, `update bookings set status = 'no_show' where id = $1`, [booking.id]);
      await appendDoorLog(client, booking.id, 'no_show', user.id, user.displayName, now);
      return replyWithBooking(client, booking.id, user.role, now);
    });
  },
};

const doorList: Route = {
  method: 'GET',
  pattern: '/api/door',
  roles: ['owner', 'shift_lead'],
  originSensitive: true,
  handler: async (ctx: Ctx): Promise<Reply> =>
    withTransaction(async (client) => {
      const now = await transactionNow(client);
      const today = kitchenDate(now);
      const date = readDateQuery(ctx, false, today);
      const bookings = await bookingsStartingOn(
        client,
        instantOfKitchenLocal(date, 0),
        instantOfKitchenLocal(date, 24 * 60),
      );
      return {
        status: 200,
        body: {
          date,
          now: kitchenIso(now),
          entries: await loadDoorEntries(client, bookings, date, now, today),
        },
      };
    }),
};

export const doorRoutes: ReadonlyArray<Route> = [checkIn, checkOut, noShow, doorList];
