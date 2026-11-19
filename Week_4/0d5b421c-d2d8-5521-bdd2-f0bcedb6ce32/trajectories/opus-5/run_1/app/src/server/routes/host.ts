import { Router } from 'express';
import type {
  Booking,
  HostBookingsResponse,
  HostFloorResponse,
  HostFloorTable,
  HostSessionResponse,
  HostTableStatus,
} from '../../shared/types';
import { serverNow } from '../clock';
import { config } from '../config';
import { pool, query, withTransaction } from '../db';
import {
  BOOKING_COLUMNS,
  endBookingWindowNow,
  findBookingByReference,
  insertBooking,
  isTableConflict,
  releaseBookingTables,
  reserveReference,
  toBooking,
  type BookingRow,
} from '../domain/bookings';
import { claimKeysFor, enqueueFreedTables } from '../domain/claims';
import { fitsBySeatRange, loadLayout, requireUnit } from '../domain/floor';
import {
  clearSessionCookie,
  currentHost,
  setSessionCookie,
  signIn,
  signOut,
} from '../domain/hostSession';
import {
  coversFree,
  eveningWindows,
  occupiedTableIds,
  unitFreeForWindow,
} from '../domain/occupancy';
import { currentSlot, noShowAllowed, slotStartsAt, turnWindow } from '../domain/rules';
import { errors } from '../errors';
import { asyncHandler, sendJson } from '../http';
import { readIdempotencyKey, withIdempotency } from '../idempotency';
import { publishLiveEvent } from '../services/events';
import { claimSlots, releaseSlots, valkeyAnswering } from '../services/valkey';
import { isoUtc, lisbonDate } from '../time';
import { asRecord, Validator } from '../validate';

export const hostRouter = Router();

hostRouter.post(
  '/host/session',
  asyncHandler(async (req, res) => {
    const body = asRecord(req.body);
    const email = typeof body.email === 'string' ? body.email : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const session = await signIn(email, password);
    setSessionCookie(res, session.token);
    const response: HostSessionResponse = {
      host: { email: session.email, name: session.name },
      expires_at: isoUtc(session.expiresAt),
    };
    sendJson(res, 200, response);
  }),
);

hostRouter.delete(
  '/host/session',
  asyncHandler(async (req, res) => {
    await signOut(req);
    clearSessionCookie(res);
    res.status(204).end();
  }),
);

hostRouter.get(
  '/host/floor',
  asyncHandler(async (req, res) => {
    await currentHost(req);
    const now = serverNow();
    const slot = currentSlot(now);
    const validator = new Validator();
    const requested = req.query.time;
    const time =
      requested === undefined
        ? slot.time
        : validator.finish({ time: validator.slotTime('time', requested) }).time;
    const layout = await loadLayout();
    const date = slot.date;
    const startsAt = slotStartsAt(date, time);
    const windows = await eveningWindows(pool, date, now);
    const occupied = occupiedTableIds(windows, startsAt);
    const covers = coversFree(layout, occupied);

    const bookingRows = await query<BookingRow>(
      pool,
      `select ${BOOKING_COLUMNS} from bookings b where b.date = $1`,
      [date],
    );
    const bookingsById = new Map(bookingRows.rows.map((row) => [row.id, row]));

    const tables: HostFloorTable[] = layout.tables.map((table) => {
      const occupying = windows
        .filter(
          (window) =>
            window.tableId === table.tableId &&
            window.start.getTime() <= startsAt.getTime() &&
            startsAt.getTime() < window.end.getTime(),
        )
        .sort((a, b) => rank(b) - rank(a))[0];
      if (!occupying) {
        return {
          table_id: table.tableId,
          room_id: table.roomId,
          status: 'free',
          joined_with: null,
          hold: null,
          offer: null,
          booking: null,
        };
      }
      const unit = requireUnit(layout, occupying.unitId);
      const joinedWith = unit.isPair
        ? (unit.tableIds.find((id) => id !== table.tableId) ?? null)
        : null;
      const status: HostTableStatus =
        occupying.kind === 'booking'
          ? occupying.bookingStatus === 'seated'
            ? 'seated'
            : 'booked'
          : occupying.kind === 'offer'
            ? 'offered'
            : 'held';
      const bookingRow = occupying.bookingId ? bookingsById.get(occupying.bookingId) : undefined;
      return {
        table_id: table.tableId,
        room_id: table.roomId,
        status,
        joined_with: joinedWith,
        hold:
          occupying.kind === 'hold' && occupying.expiresAt
            ? {
                party_size: occupying.partySize,
                expires_at: isoUtc(occupying.expiresAt),
              }
            : null,
        offer:
          occupying.kind === 'offer' && occupying.expiresAt
            ? { expires_at: isoUtc(occupying.expiresAt) }
            : null,
        booking: bookingRow ? toBooking(bookingRow, layout) : null,
      };
    });

    const response: HostFloorResponse = {
      date,
      time,
      server_now: isoUtc(now),
      totals: {
        covers_free: covers.total,
        rooms: layout.rooms.map((room) => ({
          room_id: room.roomId,
          name: room.name,
          seats: room.seats,
          covers_free: covers.byRoom.get(room.roomId) ?? 0,
        })),
      },
      tables,
    };
    sendJson(res, 200, response);
  }),
);

function rank(window: { kind: string; bookingStatus: string | null }): number {
  if (window.kind === 'booking') return window.bookingStatus === 'seated' ? 4 : 3;
  if (window.kind === 'offer') return 2;
  return 1;
}

hostRouter.get(
  '/host/bookings',
  asyncHandler(async (req, res) => {
    await currentHost(req);
    const layout = await loadLayout();
    const date = lisbonDate(serverNow());
    const rows = await query<BookingRow>(
      pool,
      `select ${BOOKING_COLUMNS} from bookings b where b.date = $1 order by b.time, b.seq`,
      [date],
    );
    const response: HostBookingsResponse = {
      date,
      bookings: rows.rows.map((row) => toBooking(row, layout)),
    };
    sendJson(res, 200, response);
  }),
);

async function loadBookingForAction(reference: string): Promise<BookingRow> {
  const booking = await findBookingByReference(pool, reference);
  if (!booking) throw errors.notFound();
  return booking;
}

hostRouter.post(
  '/host/bookings/:reference/seat',
  asyncHandler(async (req, res) => {
    await currentHost(req);
    const layout = await loadLayout();
    const booking = await loadBookingForAction(req.params.reference ?? '');
    if (booking.status !== 'booked') throw errors.invalidTransition();
    if (booking.date !== lisbonDate(serverNow())) throw errors.notTonight();
    const unit = requireUnit(layout, booking.unit_id);
    const updated = await query<BookingRow>(
      pool,
      `update bookings b set status = 'seated' where b.id = $1 and b.status = 'booked'
       returning ${BOOKING_COLUMNS}`,
      [booking.id],
    );
    const row = updated.rows[0];
    if (!row) throw errors.invalidTransition();
    await publishLiveEvent({
      type: 'booking.seated',
      date: row.date,
      time: row.time,
      tableIds: unit.tableIds,
      partySize: row.party_size,
      reference: row.reference,
      name: row.name,
    });
    sendJson(res, 200, { booking: toBooking(row, layout) });
  }),
);

hostRouter.post(
  '/host/bookings/:reference/clear',
  asyncHandler(async (req, res) => {
    await currentHost(req);
    const layout = await loadLayout();
    const booking = await loadBookingForAction(req.params.reference ?? '');
    if (booking.status !== 'seated') throw errors.invalidTransition();
    const unit = requireUnit(layout, booking.unit_id);
    const now = serverNow();
    const row = await withTransaction(async (client) => {
      const updated = await query<BookingRow>(
        client,
        `update bookings b set status = 'completed' where b.id = $1 and b.status = 'seated'
         returning ${BOOKING_COLUMNS}`,
        [booking.id],
      );
      const result = updated.rows[0];
      if (!result) throw errors.invalidTransition();
      await endBookingWindowNow(client, booking.id, now);
      await enqueueFreedTables(client, booking.date, unit.tableIds);
      return result;
    });
    await publishLiveEvent({
      type: 'booking.completed',
      date: row.date,
      time: row.time,
      tableIds: unit.tableIds,
      partySize: row.party_size,
      reference: row.reference,
      name: row.name,
    });
    sendJson(res, 200, { booking: toBooking(row, layout) });
  }),
);

hostRouter.post(
  '/host/bookings/:reference/no-show',
  asyncHandler(async (req, res) => {
    await currentHost(req);
    const layout = await loadLayout();
    const booking = await loadBookingForAction(req.params.reference ?? '');
    if (booking.status !== 'booked') throw errors.invalidTransition();
    const now = serverNow();
    if (!noShowAllowed(new Date(booking.starts_at), now)) throw errors.tooEarly();
    const unit = requireUnit(layout, booking.unit_id);
    const depositState = booking.deposit_state === 'paid' ? 'retained' : booking.deposit_state;
    const row = await withTransaction(async (client) => {
      const updated = await query<BookingRow>(
        client,
        `update bookings b set status = 'no_show', deposit_state = $2
         where b.id = $1 and b.status = 'booked' returning ${BOOKING_COLUMNS}`,
        [booking.id, depositState],
      );
      const result = updated.rows[0];
      if (!result) throw errors.invalidTransition();
      await releaseBookingTables(client, booking.id);
      await enqueueFreedTables(client, booking.date, unit.tableIds);
      return result;
    });
    await publishLiveEvent({
      type: 'booking.no_show',
      date: row.date,
      time: row.time,
      tableIds: unit.tableIds,
      partySize: row.party_size,
      reference: row.reference,
      name: row.name,
    });
    sendJson(res, 200, { booking: toBooking(row, layout) });
  }),
);

hostRouter.post(
  '/host/walk-ins',
  asyncHandler(async (req, res) => {
    const key = readIdempotencyKey(req.headers['idempotency-key'] as string | undefined);
    await currentHost(req);
    const outcome = await withIdempotency(key, 'POST', '/api/host/walk-ins', req.body, async () => {
      const layout = await loadLayout();
      const body = asRecord(req.body);
      const validator = new Validator();
      const { unit, partySize } = validator.finish({
        unit: validator.unit('table_id', body.table_id, layout),
        partySize: validator.partyFromBody('party_size', body.party_size),
      });
      if (!fitsBySeatRange(unit, partySize)) throw errors.tableNotForParty();

      const now = serverNow();
      const slot = currentSlot(now);
      const startsAt = slotStartsAt(slot.date, slot.time);
      const window = turnWindow(partySize, startsAt);
      const windows = await eveningWindows(pool, slot.date, now);
      if (!unitFreeForWindow(windows, unit, window)) throw errors.tableTaken();
      if (!(await valkeyAnswering())) throw errors.holdsPaused();

      const walkInId = `walkin:${Date.now()}:${unit.unitId}`;
      const keys = claimKeysFor(unit, window);
      let claimed: boolean;
      try {
        claimed = await claimSlots(keys, walkInId, config.holdSeconds * 1000);
      } catch {
        throw errors.holdsPaused();
      }
      if (!claimed) throw errors.tableTaken();

      let booking: Booking;
      try {
        const row = await withTransaction(async (client) =>
          insertBooking(client, {
            reference: await reserveReference(client),
            status: 'seated',
            source: 'walk_in',
            date: slot.date,
            time: slot.time,
            startsAt,
            windowStart: window.start,
            windowEnd: window.end,
            partySize,
            unitId: unit.unitId,
            pairId: unit.isPair ? unit.unitId : null,
            roomId: unit.roomId,
            tableIds: unit.tableIds,
            name: 'Walk-in',
            email: null,
            phone: null,
            depositCents: 0,
            depositState: 'none',
            manageToken: null,
            killbillPaymentId: null,
            killbillTransactionId: null,
          }),
        );
        booking = toBooking(row, layout);
      } catch (error) {
        if (isTableConflict(error)) throw errors.tableTaken();
        throw error;
      } finally {
        await releaseSlots(keys, walkInId).catch(() => undefined);
      }

      await publishLiveEvent({
        type: 'walkin.seated',
        date: slot.date,
        time: slot.time,
        tableIds: unit.tableIds,
        partySize,
        reference: booking.reference,
        name: booking.name,
      });
      return { status: 201, body: { booking } };
    });
    sendJson(res, outcome.status, outcome.body);
  }),
);
