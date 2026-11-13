import { randomUUID } from 'node:crypto';
import { config } from '../config';
import {
  errorCode,
  PG_DEADLOCK,
  PG_EXCLUSION_VIOLATION,
  PG_SERIALIZATION_FAILURE,
  query,
  transactionNow,
  withTransaction,
  type Db,
} from '../db';
import { instantOfKitchenLocal, kitchenDate, kitchenIso } from '../kitchen-time';
import { serverMessage } from '../../shared/copy';
import { isCalendarDate } from '../../shared/format';
import {
  bookingById,
  bookingStanding,
  cancelCreditMinutesOf,
  cutoffOf,
  lockBooking,
  minutesOf,
  type BookingRow,
} from '../domain/bookings';
import { coversDate, currentDocuments } from '../domain/documents';
import { bookingMinutes, bufferEndOf, releaseExpiredHolds } from '../domain/occupancy';
import { choosePack, lockActivePacks, lockPack, packById, writeMovement } from '../domain/packs';
import { checkBookingShape, type ShapeStation } from '../domain/span';
import { tenantById, tenantStanding } from '../domain/tenants';
import { bookingConfirmedMail, bookingMovedMail, queueMail } from '../domain/mail';
import { nudgeMailQueue } from '../mail-worker';
import { conflict, notFound, unauthenticated, validationFailed } from '../http/errors';
import { finishValidation } from '../http/validate';
import { bookingsOfTenant, bookingsStartingOn, loadBookingViews, loadStations, stationMap } from '../views';
import type { Ctx, Reply, Route } from '../http/route';
import type { Booking, Role } from '../../shared/types';

const BOOKING_BODY_FIELDS = ['stationId', 'start', 'end', 'shelfId'] as const;

function tenantOf(ctx: Ctx): string {
  const user = ctx.user;
  if (user === null) throw unauthenticated();
  if (user.tenantId === null) throw notFound();
  return user.tenantId;
}

async function shapeStations(client: Db): Promise<Map<string, ShapeStation>> {
  const stations = await loadStations(client);
  return new Map(stations.map((station) => [station.id, { id: station.id, kind: station.kind }]));
}

function slotTakenIfContention(error: unknown): never {
  const code = errorCode(error);
  if (code === PG_EXCLUSION_VIOLATION || code === PG_DEADLOCK || code === PG_SERIALIZATION_FAILURE) {
    throw conflict('slot_taken', serverMessage.slotTaken);
  }
  throw error;
}

async function insertOccupancies(
  client: Db,
  bookingId: string,
  stationIds: ReadonlyArray<string>,
  start: Date,
  bufferEnd: Date,
): Promise<void> {
  for (const stationId of [...stationIds].sort()) {
    try {
      await query(
        client,
        `insert into booking_occupancies (booking_id, station_id, period)
         values ($1, $2, tstzrange($3, $4, '[)'))`,
        [bookingId, stationId, start, bufferEnd],
      );
    } catch (error) {
      slotTakenIfContention(error);
    }
  }
}

async function viewOf(client: Db, booking: BookingRow, role: Role, now: Date): Promise<Booking> {
  const views = await loadBookingViews(client, [booking], role, now);
  const view = views[0];
  if (view === undefined) throw notFound();
  return view;
}

async function documentsCover(client: Db, tenantId: string, date: string): Promise<boolean> {
  const documents = await currentDocuments(client, tenantId);
  return coversDate(documents.insurance, date) && coversDate(documents.foodHandler, date);
}

async function refuseUnlessApproved(client: Db, tenantId: string, now: Date): Promise<void> {
  const tenant = await tenantById(client, tenantId);
  if (tenant === null) throw notFound();
  const standing = tenantStanding(tenant, await currentDocuments(client, tenantId), kitchenDate(now));
  if (standing.status !== 'approved') {
    throw conflict('tenant_not_approved', serverMessage.tenantNotApproved);
  }
}

async function ownBookingOr404(ctx: Ctx, client: Db): Promise<void> {
  const booking = await bookingById(client, ctx.params.id ?? '');
  if (booking === null) throw notFound();
  if (ctx.user?.role === 'tenant' && booking.tenant_id !== ctx.user.tenantId) throw notFound();
}

const claim: Route = {
  method: 'POST',
  pattern: '/api/bookings',
  roles: ['tenant'],
  bodyFields: BOOKING_BODY_FIELDS,
  requiresKey: true,
  countsClaim: true,
  idempotencyBody: (ctx: Ctx) => ({
    stationId: ctx.body.stationId ?? null,
    start: ctx.body.start ?? null,
    end: ctx.body.end ?? null,
    shelfId: ctx.body.shelfId ?? null,
  }),
  handler: async (ctx: Ctx): Promise<Reply> =>
    withTransaction(async (client) => {
      const tenantId = tenantOf(ctx);
      const now = await transactionNow(client);
      await releaseExpiredHolds(client, now);
      const shape = checkBookingShape(
        {
          stationId: ctx.body.stationId,
          shelfId: ctx.body.shelfId,
          start: ctx.body.start,
          end: ctx.body.end,
        },
        await shapeStations(client),
        now,
        null,
      );
      finishValidation(ctx, shape.fields);
      const station = shape.station;
      const start = shape.start;
      const end = shape.end;
      if (station === null || start === null || end === null) throw validationFailed(shape.fields);
      const stationIds = shape.shelf === null ? [station.id] : [station.id, shape.shelf.id];

      await refuseUnlessApproved(client, tenantId, now);
      if (!(await documentsCover(client, tenantId, kitchenDate(start)))) {
        throw conflict('documents_not_valid', serverMessage.documentsNotValid);
      }

      const minutes = bookingMinutes(start, end, stationIds.length);
      const pack = choosePack(await lockActivePacks(client, tenantId, now), minutes);
      if (pack === null) throw conflict('insufficient_hours', serverMessage.insufficientHours);

      const bufferEnd = bufferEndOf(end);
      const bookingId = randomUUID();
      await query(
        client,
        `insert into bookings (id, tenant_id, station_id, shelf_id, start_at, end_at, buffer_end_at,
           status, hold_expires_at, pack_id)
         values ($1,$2,$3,$4,$5,$6,$7,'held',$8,$9)`,
        [
          bookingId,
          tenantId,
          station.id,
          shape.shelf?.id ?? null,
          start,
          end,
          bufferEnd,
          new Date(now.getTime() + config.holdSeconds * 1000),
          pack.row.id,
        ],
      );
      await insertOccupancies(client, bookingId, stationIds, start, bufferEnd);
      const booking = await bookingById(client, bookingId);
      if (booking === null) throw notFound();
      return { status: 201, body: await viewOf(client, booking, 'tenant', now) };
    }).catch((error: unknown) => slotTakenIfContention(error)),
};

const confirm: Route = {
  method: 'POST',
  pattern: '/api/bookings/:id/confirm',
  roles: ['tenant'],
  resolve: ownBookingOr404,
  handler: async (ctx: Ctx): Promise<Reply> => {
    const reply = await withTransaction(async (client) => {
      const tenantId = tenantOf(ctx);
      const now = await transactionNow(client);
      const booking = await lockBooking(client, ctx.params.id ?? '');
      if (booking === null || booking.tenant_id !== tenantId) throw notFound();

      const neverConfirmed =
        booking.status === 'held' ||
        (booking.status === 'cancelled' && booking.cancel_reason === 'hold_expired');
      if (
        neverConfirmed &&
        booking.hold_expires_at !== null &&
        now.getTime() >= booking.hold_expires_at.getTime()
      ) {
        throw conflict('hold_expired', serverMessage.holdExpired);
      }
      if (booking.status === 'confirmed') {
        return { status: 200, body: await viewOf(client, booking, 'tenant', now) };
      }
      if (booking.status !== 'held') {
        throw conflict('invalid_transition', serverMessage.invalidTransition);
      }
      if (!(await documentsCover(client, tenantId, kitchenDate(booking.start_at)))) {
        throw conflict('documents_not_valid', serverMessage.documentsNotValid);
      }

      const packId = booking.pack_id;
      if (packId === null) throw conflict('invalid_transition', serverMessage.invalidTransition);
      const minutes = minutesOf(booking);
      await lockPack(client, packId, now);
      await writeMovement(client, packId, 'booking_debit', -minutes, booking.id);
      await query(client, `update bookings set status = 'confirmed', debited_minutes = $2 where id = $1`, [
        booking.id,
        minutes,
      ]);

      const tenant = await tenantById(client, tenantId);
      const pack = await packById(client, packId, now);
      const updated = await bookingById(client, booking.id);
      if (tenant === null || pack === null || updated === null) throw notFound();
      const view = await viewOf(client, updated, 'tenant', now);
      const mail = bookingConfirmedMail({
        stationName: view.stationName,
        shelfName: view.shelfName,
        startIso: view.start,
        endIso: view.end,
        minutes,
        packBalanceMinutes: pack.balanceMinutes,
        bookingId: booking.id,
      });
      await queueMail(
        client,
        'booking_confirmed',
        booking.id,
        { contactName: tenant.contact_name, email: tenant.email },
        mail.subject,
        mail.body,
      );
      return { status: 200, body: await viewOf(client, updated, 'tenant', now) };
    });
    nudgeMailQueue();
    return reply;
  },
};

const move: Route = {
  method: 'POST',
  pattern: '/api/bookings/:id/move',
  roles: ['tenant'],
  bodyFields: BOOKING_BODY_FIELDS,
  requiresKey: true,
  resolve: ownBookingOr404,
  idempotencyBody: (ctx: Ctx) => ({
    bookingId: ctx.params.id ?? '',
    stationId: ctx.body.stationId ?? null,
    start: ctx.body.start ?? null,
    end: ctx.body.end ?? null,
    shelfId: ctx.body.shelfId ?? null,
  }),
  handler: async (ctx: Ctx): Promise<Reply> => {
    const reply = await withTransaction(async (client) => {
      const tenantId = tenantOf(ctx);
      const now = await transactionNow(client);
      await releaseExpiredHolds(client, now);
      const booking = await lockBooking(client, ctx.params.id ?? '');
      if (booking === null || booking.tenant_id !== tenantId) throw notFound();

      const shape = checkBookingShape(
        {
          stationId: ctx.body.stationId,
          shelfId: ctx.body.shelfId,
          start: ctx.body.start,
          end: ctx.body.end,
        },
        await shapeStations(client),
        now,
        {
          stationId: booking.station_id,
          shelfId: booking.shelf_id,
          start: booking.start_at,
          end: booking.end_at,
        },
      );
      finishValidation(ctx, shape.fields);
      const station = shape.station;
      const start = shape.start;
      const end = shape.end;
      if (station === null || start === null || end === null) throw validationFailed(shape.fields);

      if (booking.status !== 'confirmed') {
        throw conflict('invalid_transition', serverMessage.invalidTransition);
      }
      if (now.getTime() > cutoffOf(booking.start_at).getTime()) {
        throw conflict('past_cutoff', serverMessage.pastCutoff);
      }
      if (booking.move_count >= 1) {
        throw conflict('move_limit_reached', serverMessage.moveLimitReached);
      }
      await refuseUnlessApproved(client, tenantId, now);
      if (!(await documentsCover(client, tenantId, kitchenDate(start)))) {
        throw conflict('documents_not_valid', serverMessage.documentsNotValid);
      }

      const stationIds = shape.shelf === null ? [station.id] : [station.id, shape.shelf.id];
      const newMinutes = bookingMinutes(start, end, stationIds.length);
      const previousMinutes = booking.debited_minutes ?? minutesOf(booking);
      const increase = newMinutes - previousMinutes;
      const packId = booking.pack_id;
      if (packId === null) throw conflict('invalid_transition', serverMessage.invalidTransition);
      const pack = await lockPack(client, packId, now);
      if (pack === null) throw conflict('invalid_transition', serverMessage.invalidTransition);
      if (increase > 0 && pack.availableMinutes < increase) {
        throw conflict('insufficient_hours', serverMessage.insufficientHours);
      }

      const stations = stationMap(await loadStations(client));
      const previous = {
        startIso: kitchenIso(booking.start_at),
        endIso: kitchenIso(booking.end_at),
        stationName: stations.get(booking.station_id)?.name ?? booking.station_id,
        shelfName:
          booking.shelf_id === null ? null : stations.get(booking.shelf_id)?.name ?? booking.shelf_id,
      };

      const bufferEnd = bufferEndOf(end);
      await query(client, 'delete from booking_occupancies where booking_id = $1', [booking.id]);
      await insertOccupancies(client, booking.id, stationIds, start, bufferEnd);
      if (increase !== 0) {
        await writeMovement(client, packId, 'move_adjustment', -increase, booking.id);
      }
      await query(
        client,
        `update bookings set station_id = $2, shelf_id = $3, start_at = $4, end_at = $5,
           buffer_end_at = $6, debited_minutes = $7, move_count = 1
         where id = $1`,
        [booking.id, station.id, shape.shelf?.id ?? null, start, end, bufferEnd, newMinutes],
      );

      const tenant = await tenantById(client, tenantId);
      const updated = await bookingById(client, booking.id);
      const packAfter = await packById(client, packId, now);
      if (tenant === null || updated === null || packAfter === null) throw notFound();
      const moved = await viewOf(client, updated, 'tenant', now);
      const mail = bookingMovedMail({
        stationName: moved.stationName,
        shelfName: moved.shelfName,
        startIso: moved.start,
        endIso: moved.end,
        minutes: newMinutes,
        packBalanceMinutes: packAfter.balanceMinutes,
        bookingId: booking.id,
        previousStartIso: previous.startIso,
        previousEndIso: previous.endIso,
        previousStationName: previous.stationName,
        previousShelfName: previous.shelfName,
      });
      await queueMail(
        client,
        'booking_moved',
        booking.id,
        { contactName: tenant.contact_name, email: tenant.email },
        mail.subject,
        mail.body,
      );
      return { status: 200, body: await viewOf(client, updated, 'tenant', now) };
    }).catch((error: unknown) => slotTakenIfContention(error));
    nudgeMailQueue();
    return reply;
  },
};

const cancel: Route = {
  method: 'POST',
  pattern: '/api/bookings/:id/cancel',
  roles: ['tenant'],
  resolve: ownBookingOr404,
  handler: async (ctx: Ctx): Promise<Reply> =>
    withTransaction(async (client) => {
      const tenantId = tenantOf(ctx);
      const now = await transactionNow(client);
      const booking = await lockBooking(client, ctx.params.id ?? '');
      if (booking === null || booking.tenant_id !== tenantId) throw notFound();
      const standing = bookingStanding(booking, now);

      if (standing.status !== 'held' && standing.status !== 'confirmed') {
        throw conflict('invalid_transition', serverMessage.invalidTransition);
      }

      const confirmed = standing.status === 'confirmed';
      const credit = confirmed ? cancelCreditMinutesOf(booking, now) ?? 0 : 0;
      const packId = booking.pack_id;
      if (credit > 0 && packId !== null) {
        await lockPack(client, packId, now);
        await writeMovement(client, packId, 'cancellation_credit', credit, booking.id);
      }
      await query(client, 'delete from booking_occupancies where booking_id = $1', [booking.id]);
      await query(
        client,
        `update bookings set status = 'cancelled', cancel_reason = 'tenant', refunded_minutes = $2
         where id = $1`,
        [booking.id, confirmed ? credit : null],
      );
      const updated = await bookingById(client, booking.id);
      if (updated === null) throw notFound();
      return { status: 200, body: await viewOf(client, updated, 'tenant', now) };
    }),
};

const list: Route = {
  method: 'GET',
  pattern: '/api/bookings',
  roles: ['owner', 'shift_lead', 'tenant'],
  handler: async (ctx: Ctx): Promise<Reply> => {
    const user = ctx.user;
    if (user === null) throw unauthenticated();
    const date = ctx.query.get('date');
    const fields: Record<string, string> = {};
    if (date !== null && date !== '' && !isCalendarDate(date)) fields.date = serverMessage.badDate;
    if (user.role !== 'tenant' && (date === null || date === '')) {
      fields.date = serverMessage.dateRequired;
    }
    finishValidation(ctx, fields);

    return withTransaction(async (client) => {
      const now = await transactionNow(client);
      if (user.role === 'tenant') {
        const tenantId = user.tenantId;
        if (tenantId === null) throw notFound();
        const from = date === null || date === '' ? null : instantOfKitchenLocal(date, 0);
        const bookings = await bookingsOfTenant(client, tenantId, from);
        return { status: 200, body: { bookings: await loadBookingViews(client, bookings, 'tenant', now) } };
      }
      const chosen = date ?? kitchenDate(now);
      const bookings = await bookingsStartingOn(
        client,
        instantOfKitchenLocal(chosen, 0),
        instantOfKitchenLocal(chosen, 24 * 60),
      );
      return { status: 200, body: { bookings: await loadBookingViews(client, bookings, user.role, now) } };
    });
  },
};

const detail: Route = {
  method: 'GET',
  pattern: '/api/bookings/:id',
  roles: ['owner', 'shift_lead', 'tenant'],
  resolve: ownBookingOr404,
  handler: async (ctx: Ctx): Promise<Reply> => {
    const user = ctx.user;
    if (user === null) throw unauthenticated();
    return withTransaction(async (client) => {
      const now = await transactionNow(client);
      const booking = await bookingById(client, ctx.params.id ?? '');
      if (booking === null) throw notFound();
      if (user.role === 'tenant' && booking.tenant_id !== user.tenantId) throw notFound();
      return { status: 200, body: await viewOf(client, booking, user.role, now) };
    });
  },
};

export const bookingRoutes: ReadonlyArray<Route> = [claim, list, detail, confirm, move, cancel];
