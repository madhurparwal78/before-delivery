import type { BookingRecord } from '../data/bookings';
import {
  findBooking,
  listAccountBookings,
  loadPassengers,
  loadTickets,
} from '../data/bookings';
import { loadTrain } from '../data/trains';
import type { Quota, TravelClass } from '../domain/berths';
import { isQuota, isTravelClass } from '../domain/berths';
import { isValidDateString, istTimestamp } from '../domain/ist';
import { chartAt } from '../domain/schedule';
import type { AcceptedStatus } from '../domain/status';
import { isAcceptedStatus } from '../domain/status';
import { opensAt, windowState } from '../domain/windows';
import { requireAccount } from '../http/context';
import type { RequestContext, Route } from '../http/context';
import type { FieldErrors } from '../http/errors';
import { FIELD_MESSAGES, errors } from '../http/errors';
import { TicketStorageUnavailableError } from '../services/storage';
import { createBooking, loadBookingBody } from '../service/booking';
import { assertCancellable, cancelPassengers, quoteCancellation } from '../service/cancellation';
import { bookingListEntry, publicPnrBody } from '../service/projection';
import { isPhone, validateParty } from '../service/validate';
import { routeStretch } from './trains';

function readBody(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
}

/** A PNR that belongs to another account answers exactly as one that does not exist. */
async function ownedBooking(context: RequestContext, pnr: string): Promise<BookingRecord> {
  const account = requireAccount(context);
  const booking = await findBooking(context.app.database, pnr);
  if (booking === null || booking.account_id !== account.id) throw errors.notFound();
  return booking;
}

function readPassengerNumbers(body: unknown, onPnr: readonly number[]): number[] {
  const input = readBody(body);
  const fields: FieldErrors = {};
  if (!Array.isArray(input.passengers) || input.passengers.length === 0) {
    fields.passengers = FIELD_MESSAGES.choosePassenger;
    throw errors.validation(fields);
  }
  const numbers = input.passengers.map((value) => (typeof value === 'number' ? value : -1));
  const missing = numbers.find((number) => !onPnr.includes(number));
  if (missing !== undefined) {
    fields.passengers = FIELD_MESSAGES.notOnPnr(missing);
    throw errors.validation(fields);
  }
  return [...new Set(numbers)].sort((a, b) => a - b);
}

export const bookingRoutes: readonly Route[] = [
  {
    method: 'POST',
    path: '/api/bookings',
    auth: 'required',
    needsIdempotencyKey: true,
    handler: async (context) => {
      const account = requireAccount(context);
      const input = readBody(context.body);
      const train = typeof input.train === 'string'
        ? await loadTrain(context.app.database, input.train)
        : null;
      if (train === null) throw errors.notFound();
      const from = typeof input.from === 'string' ? input.from : '';
      const to = typeof input.to === 'string' ? input.to : '';
      const stations = await context.app.database.query<{ code: string }>(
        'select code from stations where code = any($1::text[])',
        [[from, to]],
      );
      if (!stations.some((station) => station.code === from)) throw errors.notFound();
      if (!stations.some((station) => station.code === to)) throw errors.notFound();

      const envelope: FieldErrors = {};
      if (!isValidDateString(input.run_date)) envelope.run_date = FIELD_MESSAGES.date;
      if (!isTravelClass(input.class)) envelope.class = FIELD_MESSAGES.travelClass;
      if (!isQuota(input.quota)) envelope.quota = FIELD_MESSAGES.quota;
      if (Object.keys(envelope).length > 0) throw errors.validation(envelope);

      const runDate = input.run_date as string;
      const travelClass = input.class as TravelClass;
      const quota = input.quota as Quota;
      const opening = opensAt(runDate, travelClass, quota);
      const state = windowState(context.now, chartAt(train, runDate), opening);
      if (state === 'not_yet_open') {
        throw quota === 'TQ'
          ? errors.tatkalNotOpen(istTimestamp(opening))
          : errors.bookingNotOpen(istTimestamp(opening));
      }
      if (state === 'chart_prepared') throw errors.chartPrepared();

      const fields: FieldErrors = {};
      if (from === to) fields.to = FIELD_MESSAGES.sameStation;
      const party = validateParty(input.passengers, quota);
      Object.assign(fields, party.errors);
      if (!isPhone(input.contact_phone)) fields.contact_phone = FIELD_MESSAGES.phone;
      if (!isAcceptedStatus(input.accept)) fields.accept = FIELD_MESSAGES.accept;
      const route = routeStretch(train, from, to);
      if (route === null) {
        if (fields.to === undefined) fields.to = FIELD_MESSAGES.notOnRoute;
        throw errors.validation(fields);
      }
      if (Object.keys(fields).length > 0) throw errors.validation(fields);

      const body = await createBooking(
        context.app,
        account,
        {
          train,
          runDate,
          fromStop: route.fromStop,
          toStop: route.toStop,
          travelClass,
          quota,
          passengers: party.passengers,
          keepInOneCoach: input.keep_in_one_coach === true,
          lowerBerthOnly: input.lower_berth_only === true,
          accept: input.accept as AcceptedStatus,
          contactPhone: input.contact_phone as string,
        },
        context.now,
      );
      return { status: 201, json: body };
    },
  },
  {
    method: 'GET',
    path: '/api/bookings',
    auth: 'required',
    handler: async (context) => {
      const account = requireAccount(context);
      const bookings = await listAccountBookings(context.app.database, account.id);
      const entries: Record<string, unknown>[] = [];
      for (const booking of bookings) {
        const train = await loadTrain(context.app.database, booking.train_number);
        if (train === null) continue;
        entries.push(bookingListEntry(
          booking,
          await loadPassengers(context.app.database, booking.pnr),
          train,
          context.now,
        ));
      }
      return { status: 200, json: { bookings: entries } };
    },
  },
  {
    method: 'GET',
    path: '/api/bookings/:pnr',
    auth: 'required',
    handler: async (context) => {
      await ownedBooking(context, context.params.pnr);
      return {
        status: 200,
        json: await loadBookingBody(context.app, context.params.pnr, context.now),
      };
    },
  },
  {
    method: 'GET',
    path: '/api/bookings/:pnr/tickets/:version',
    auth: 'required',
    handler: async (context) => {
      await ownedBooking(context, context.params.pnr);
      const version = Number.parseInt(context.params.version, 10);
      const tickets = await loadTickets(context.app.database, context.params.pnr);
      const ticket = tickets.find((entry) => entry.version === version && entry.stored);
      if (ticket === undefined) throw errors.notFound();
      try {
        const object = await context.app.storage.get(ticket.object_key);
        return {
          status: 200,
          body: object.body,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition':
              `attachment; filename="e-ticket-${context.params.pnr}-v${version}.pdf"`,
            ETag: ticket.etag ?? object.etag,
          },
        };
      } catch (error) {
        if (error instanceof TicketStorageUnavailableError) {
          throw errors.ticketStorageUnavailable();
        }
        throw error;
      }
    },
  },
  {
    method: 'POST',
    path: '/api/bookings/:pnr/cancellation-quote',
    auth: 'required',
    handler: async (context) => {
      const booking = await ownedBooking(context, context.params.pnr);
      const train = await loadTrain(context.app.database, booking.train_number);
      if (train === null) throw errors.notFound();
      const passengers = await loadPassengers(context.app.database, booking.pnr);
      const onPnr = passengers.map((passenger) => passenger.number);
      const input = readBody(context.body);
      const requested = Array.isArray(input.passengers)
        ? input.passengers.filter((value): value is number => typeof value === 'number')
        : [];
      assertCancellable(booking, train, passengers, requested, context.now);
      const numbers = readPassengerNumbers(context.body, onPnr);
      return {
        status: 200,
        json: quoteCancellation(booking, train, passengers, numbers, context.now),
      };
    },
  },
  {
    method: 'POST',
    path: '/api/bookings/:pnr/cancellations',
    auth: 'required',
    needsIdempotencyKey: true,
    handler: async (context) => {
      const booking = await ownedBooking(context, context.params.pnr);
      const train = await loadTrain(context.app.database, booking.train_number);
      if (train === null) throw errors.notFound();
      const passengers = await loadPassengers(context.app.database, booking.pnr);
      const onPnr = passengers.map((passenger) => passenger.number);
      const input = readBody(context.body);
      const requested = Array.isArray(input.passengers)
        ? input.passengers.filter((value): value is number => typeof value === 'number')
        : [];
      assertCancellable(booking, train, passengers, requested, context.now);
      const numbers = readPassengerNumbers(context.body, onPnr);
      return {
        status: 201,
        json: await cancelPassengers(context.app, booking, train, numbers, context.now),
      };
    },
  },
  {
    method: 'GET',
    path: '/api/pnr/:pnr',
    auth: 'optional',
    handler: async (context) => {
      const pnr = context.params.pnr;
      if (!/^[1-9]\d{9}$/.test(pnr)) throw errors.notFound();
      const booking = await findBooking(context.app.database, pnr);
      if (booking === null) throw errors.notFound();
      const train = await loadTrain(context.app.database, booking.train_number);
      if (train === null) throw errors.notFound();
      return {
        status: 200,
        json: publicPnrBody(
          booking,
          await loadPassengers(context.app.database, pnr),
          train,
          context.now,
        ),
      };
    },
  },
];
