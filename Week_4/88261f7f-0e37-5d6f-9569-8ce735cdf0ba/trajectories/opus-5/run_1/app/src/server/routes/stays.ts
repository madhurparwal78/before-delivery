import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { Db, one, pool, withTransaction } from '../db';
import { addDays, dateRange, daysBetween, PlainDate } from '../../shared/dates';
import { notices } from '../../shared/notices';
import { DESK_ROLES } from '../domain/roles';
import { readyForCheckIn } from '../domain/roomStatus';
import { roomStatusWords } from '../../shared/roomStatus';
import {
  mayCancel,
  mayCheckIn,
  mayCheckOut,
  mayChangeOrMove,
  awaitingOnlineCheckIn,
} from '../domain/stayState';
import { currentNight, Hotel, loadRoom, setRoomStatus } from '../repo/hotels';
import { priceRoomNights } from '../domain/pricing';
import {
  errorTexts,
  failure,
  invalid,
  notFoundError,
  outageTexts,
  validationTexts,
} from '../http/errors';
import { Router } from '../http/router';
import { originOf } from '../http/app';
import { createGuest, findGuestByEmail, loadGuest } from '../repo/guests';
import {
  createFolio,
  entryDescriptions,
  firstOpenFolio,
  insertEntry,
  isValidPayerEmail,
} from '../repo/folios';
import {
  bumpVersion,
  buildStayView,
  cancellationFor,
  completeNights,
  firstHeldNight,
  loadStayRecord,
  loadStayView,
  lockRooms,
  ratePlanFor,
  replaceSegments,
  roomForNight,
  segmentsOf,
  SegmentView,
  storedNights,
  StayRecord,
  writeRoomNights,
} from '../repo/stays';
import { listTaxRates } from '../repo/hotels';
import { bodyHash, release, reserve, storeResponse } from '../repo/idempotency';
import { checkinLinkUrl, endLink, newToken, storeToken } from '../repo/checkinLinks';
import { mailTexts, sendMessage } from '../services/mail';
import { getObject, idPhotoObjectKey } from '../services/fileStore';
import { ProviderDownError } from '../services/providers';
import { publishStayChange } from './changes';
import {
  checkDates,
  checkGuestCount,
  checkGuestDraft,
  checkRatePlan,
  checkRoom,
  readGuestDraft,
} from './stayInput';
import { dateField, hotelOf, integerField, optionalText, textField } from './support';

const IDEMPOTENCY_HEADER = 'idempotency-key';

interface NightRoom {
  date: PlainDate;
  roomId: string;
}

/** Groups consecutive nights on one room into the stay's blocks. */
function segmentsFromNights(nights: NightRoom[]): Array<{
  roomId: string;
  firstNight: PlainDate;
  nights: number;
}> {
  const segments: Array<{ roomId: string; firstNight: PlainDate; nights: number }> = [];
  for (const night of nights) {
    const last = segments[segments.length - 1];
    if (last && last.roomId === night.roomId && addDays(last.firstNight, last.nights) === night.date) {
      last.nights += 1;
      continue;
    }
    segments.push({ roomId: night.roomId, firstNight: night.date, nights: 1 });
  }
  return segments;
}

function nightsWithRooms(
  segments: SegmentView[],
  arrival: PlainDate,
  departure: PlainDate,
): NightRoom[] {
  const firstRoom = segments.length > 0 ? segments[0].roomId : '';
  const lastRoom = segments.length > 0 ? segments[segments.length - 1].roomId : '';
  return dateRange(arrival, daysBetween(arrival, departure)).map((date) => {
    const segment = roomForNight(segments, date);
    if (segment) return { date, roomId: segment.roomId };
    return { date, roomId: date < segments[0].firstNight ? firstRoom : lastRoom };
  });
}

async function refuseHeldNights(
  db: Db,
  roomId: string,
  dates: PlainDate[],
  stayId: string | null,
  roomNumber: string,
  asTaken: boolean,
): Promise<void> {
  const held = await firstHeldNight(db, roomId, dates, stayId);
  if (held === null) return;
  throw failure(
    409,
    asTaken ? errorTexts.roomJustTaken(roomNumber) : errorTexts.roomOccupied(roomNumber, held),
  );
}

async function deliverCheckinLink(
  hotel: Hotel,
  stayId: string,
  guestEmail: string,
  origin: string,
): Promise<void> {
  const token = newToken();
  await sendMessage({
    to: guestEmail,
    subject: mailTexts.checkinSubject(hotel.name),
    text: mailTexts.checkinBody(checkinLinkUrl(origin, token)),
  });
  await storeToken(pool, hotel, stayId, token);
}

async function stayRoomIds(db: Db, stayId: string): Promise<string[]> {
  const segments = await segmentsOf(db, stayId);
  return segments.map((segment) => segment.roomId);
}

async function requireStay(hotel: Hotel, stayId: string): Promise<StayRecord> {
  const stay = await loadStayRecord(pool, hotel.id, stayId);
  if (!stay) throw notFoundError();
  return stay;
}

function requireVersion(body: Record<string, unknown>, stay: StayRecord): void {
  const version = integerField(body, 'version');
  if (version === null || version !== stay.version) {
    throw failure(409, errorTexts.staleVersion);
  }
}

async function guestOf(db: Db, guestId: string): Promise<{ name: string; email: string }> {
  const guest = await one<{ name: string; email: string }>(
    db,
    'select name, email from guests where id = $1',
    [guestId],
  );
  return guest ?? { name: '', email: '' };
}

export function registerStayRoutes(router: Router): void {
  router.add({
    method: 'POST',
    pattern: '/api/stays/quote',
    access: DESK_ROLES,
    bodyMode: 'json',
    handler: async (ctx) => {
      const hotel = await hotelOf(ctx);
      const errors = {
        ...checkDates(hotel, ctx.body.arrival, ctx.body.departure, { inHouse: false }),
        ...checkGuestCount(ctx.body.guests),
        ...(await checkRoom(pool, hotel, ctx.body.roomId)),
        ...(await checkRatePlan(pool, hotel, ctx.body.ratePlanId)),
      };
      if (Object.keys(errors).length > 0) throw invalid(errors);
      const arrival = dateField(ctx.body, 'arrival') as PlainDate;
      const departure = dateField(ctx.body, 'departure') as PlainDate;
      const guests = integerField(ctx.body, 'guests') as number;
      const room = await loadRoom(pool, hotel.id, textField(ctx.body, 'roomId'));
      const plan = await ratePlanFor(pool, hotel, textField(ctx.body, 'ratePlanId'));
      if (!room || !plan) throw notFoundError();
      const taxRates = await listTaxRates(pool, hotel.id);
      const totalNights = daysBetween(arrival, departure);
      const stored = priceRoomNights(plan, arrival, totalNights, guests).map((night) => ({
        date: night.date,
        roomCents: night.roomCents,
        posted: false,
        postedTaxCents: null,
        postedCityTaxCents: null,
      }));
      const nightly = completeNights(
        stored,
        [{ roomId: room.id, roomNumber: room.number, firstNight: arrival, nights: totalNights }],
        guests,
        taxRates,
      );
      return {
        status: 200,
        json: {
          nightly,
          totalCents: nightly.reduce((total, night) => total + night.totalCents, 0),
        },
      };
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/stays',
    access: DESK_ROLES,
    bodyMode: 'json',
    handler: async (ctx) => {
      const hotel = await hotelOf(ctx);
      const header = ctx.req.headers[IDEMPOTENCY_HEADER];
      const key = typeof header === 'string' ? header : '';
      if (key.length < 1 || key.length > 200) {
        throw invalid({ idempotencyKey: validationTexts.idempotencyKey });
      }
      const hash = bodyHash(ctx.body);
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const reservation = await reserve(pool, hotel.id, key, hash);
        if (reservation.kind === 'mismatch') {
          throw failure(409, errorTexts.idempotencyMismatch);
        }
        if (reservation.kind === 'replay') {
          return { status: reservation.status, json: reservation.response };
        }
        if (reservation.kind === 'inFlight') {
          await new Promise((resolve) => {
            setTimeout(resolve, 50);
          });
          continue;
        }
        try {
          const view = await createStay(ctx.body, hotel, originOf(ctx.req));
          await storeResponse(pool, hotel.id, key, 201, view);
          return { status: 201, json: view };
        } catch (error) {
          await release(pool, hotel.id, key);
          throw error;
        }
      }
      throw failure(409, errorTexts.idempotencyMismatch);
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/stays/:id',
    access: DESK_ROLES,
    bodyMode: 'none',
    handler: async (ctx) => {
      const hotel = await hotelOf(ctx);
      const view = await loadStayView(pool, hotel, ctx.params.id);
      if (!view) throw notFoundError();
      return { status: 200, json: view };
    },
  });

  router.add({
    method: 'PATCH',
    pattern: '/api/stays/:id',
    access: DESK_ROLES,
    bodyMode: 'json',
    handler: async (ctx) => {
      const hotel = await hotelOf(ctx);
      const stay = await requireStay(hotel, ctx.params.id);
      if (!mayChangeOrMove(stay.status)) throw failure(409, errorTexts.cannotMove);
      const inHouse = stay.status === 'in_house';
      const nextArrival = dateField(ctx.body, 'arrival') ?? stay.arrival;
      if (inHouse && 'arrival' in ctx.body && nextArrival !== stay.arrival) {
        throw failure(409, errorTexts.inHouseArrival);
      }
      requireVersion(ctx.body, stay);

      const arrival = inHouse ? stay.arrival : nextArrival;
      const departure = 'departure' in ctx.body ? ctx.body.departure : stay.departure;
      const guests = 'guests' in ctx.body ? ctx.body.guests : stay.guests;
      const ratePlanId = 'ratePlanId' in ctx.body ? ctx.body.ratePlanId : stay.ratePlanId;
      const errors = {
        ...checkDates(hotel, arrival, departure, { inHouse }),
        ...checkGuestCount(guests),
        ...(await checkRatePlan(pool, hotel, ratePlanId)),
      };
      if (Object.keys(errors).length > 0) throw invalid(errors);

      const view = await withTransaction(async (db) => {
        const segments = await segmentsOf(db, stay.id);
        await lockRooms(db, segments.map((segment) => segment.roomId));
        const newNights = nightsWithRooms(segments, arrival, departure as PlainDate);
        const currentDates = new Set(
          dateRange(stay.arrival, daysBetween(stay.arrival, stay.departure)),
        );
        const addedByRoom = new Map<string, PlainDate[]>();
        for (const night of newNights) {
          if (currentDates.has(night.date)) continue;
          const list = addedByRoom.get(night.roomId) ?? [];
          list.push(night.date);
          addedByRoom.set(night.roomId, list);
        }
        for (const [roomId, dates] of addedByRoom) {
          const room = await loadRoom(db, hotel.id, roomId);
          await refuseHeldNights(db, roomId, dates, stay.id, room ? room.number : '', false);
        }
        await db.query(
          'update stays set arrival = $2, departure = $3, guests = $4, rate_plan_id = $5 where id = $1',
          [stay.id, arrival, departure, guests, ratePlanId],
        );
        await replaceSegments(db, stay.id, segmentsFromNights(newNights));
        const plan = await ratePlanFor(db, hotel, ratePlanId as string);
        if (plan) {
          await writeRoomNights(
            db,
            stay.id,
            plan,
            arrival,
            departure as PlainDate,
            guests as number,
          );
        }
        await bumpVersion(db, stay.id);
        const record = await loadStayRecord(db, hotel.id, stay.id);
        const built = await buildStayView(db, hotel, record as StayRecord);
        await publishStayChange(db, hotel, {
          type: 'stay',
          stayId: stay.id,
          notice: notices.stayUpdated(built.guest.name),
          roomIds: [...new Set(built.segments.map((segment) => segment.roomId))],
        });
        return built;
      });
      return { status: 200, json: view };
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/stays/:id/move',
    access: DESK_ROLES,
    bodyMode: 'json',
    handler: async (ctx) => {
      const hotel = await hotelOf(ctx);
      const stay = await requireStay(hotel, ctx.params.id);
      if (!mayChangeOrMove(stay.status)) throw failure(409, errorTexts.cannotMove);
      requireVersion(ctx.body, stay);

      const room = await loadRoom(pool, hotel.id, textField(ctx.body, 'roomId'));
      if (!room) throw notFoundError();

      const sentArrival = 'arrival' in ctx.body;
      const sentFromNight = 'fromNight' in ctx.body;
      if (sentArrival && sentFromNight) {
        throw invalid({ arrival: validationTexts.moveBothFields });
      }
      const stayNights = dateRange(stay.arrival, daysBetween(stay.arrival, stay.departure));

      if (sentArrival) {
        if (stay.status !== 'booked') throw invalid({ arrival: validationTexts.moveNotBooked });
        const arrival = dateField(ctx.body, 'arrival');
        if (arrival === null || arrival < hotel.businessDate) {
          throw invalid({ arrival: validationTexts.arrivalBeforeBusinessDate });
        }
      }

      let fromNight: PlainDate | null = null;
      if (sentFromNight) {
        const value = dateField(ctx.body, 'fromNight');
        if (value === null || !stayNights.includes(value) || value < hotel.businessDate) {
          throw invalid({ fromNight: validationTexts.fromNight });
        }
        fromNight = value;
      } else if (stay.status === 'in_house' && !sentArrival) {
        if (!stayNights.includes(hotel.businessDate)) {
          throw invalid({ fromNight: validationTexts.fromNight });
        }
        fromNight = hotel.businessDate;
      }

      const view = await withTransaction(async (db) => {
        const segments = await segmentsOf(db, stay.id);
        await lockRooms(db, [...segments.map((segment) => segment.roomId), room.id]);

        let arrival = stay.arrival;
        let departure = stay.departure;
        let nights: NightRoom[];
        let reprice = false;

        if (sentArrival) {
          arrival = dateField(ctx.body, 'arrival') as PlainDate;
          departure = addDays(arrival, stayNights.length);
          nights = dateRange(arrival, stayNights.length).map((date) => ({ date, roomId: room.id }));
          reprice = true;
        } else if (fromNight === null) {
          nights = stayNights.map((date) => ({ date, roomId: room.id }));
        } else {
          nights = nightsWithRooms(segments, stay.arrival, stay.departure).map((night) =>
            night.date >= (fromNight as PlainDate) ? { date: night.date, roomId: room.id } : night,
          );
        }

        const landing = nights
          .filter((night) => night.roomId === room.id)
          .map((night) => night.date);
        await refuseHeldNights(db, room.id, landing, stay.id, room.number, false);

        const businessDateSegment = roomForNight(segments, hotel.businessDate);
        const movesBusinessDateNight =
          stay.status === 'in_house' &&
          businessDateSegment !== null &&
          businessDateSegment.roomId !== room.id &&
          fromNight !== null &&
          fromNight <= hotel.businessDate;
        if (movesBusinessDateNight && !readyForCheckIn(room.status)) {
          throw failure(
            409,
            errorTexts.roomNotReadyForMove(room.number, roomStatusWords(room.status)),
          );
        }

        await db.query('update stays set arrival = $2, departure = $3 where id = $1', [
          stay.id,
          arrival,
          departure,
        ]);
        await replaceSegments(db, stay.id, segmentsFromNights(nights));
        if (reprice) {
          const plan = await ratePlanFor(db, hotel, stay.ratePlanId);
          if (plan) await writeRoomNights(db, stay.id, plan, arrival, departure, stay.guests);
        }
        if (movesBusinessDateNight && businessDateSegment) {
          await setRoomStatus(db, businessDateSegment.roomId, 'dirty');
        }
        await bumpVersion(db, stay.id);
        const record = await loadStayRecord(db, hotel.id, stay.id);
        const built = await buildStayView(db, hotel, record as StayRecord);
        const touched = new Set<string>([
          room.id,
          ...segments.map((segment) => segment.roomId),
          ...built.segments.map((segment) => segment.roomId),
        ]);
        await publishStayChange(db, hotel, {
          type: 'stay',
          stayId: stay.id,
          notice: notices.moved(built.guest.name, room.number),
          roomIds: [room.id, ...[...touched].filter((id) => id !== room.id)],
        });
        return built;
      });
      return { status: 200, json: view };
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/stays/:id/check-in',
    access: DESK_ROLES,
    bodyMode: 'json',
    handler: async (ctx) => {
      const hotel = await hotelOf(ctx);
      const stay = await requireStay(hotel, ctx.params.id);
      if (!mayCheckIn(stay.status)) throw failure(409, errorTexts.cannotCheckIn);
      if (stay.arrival !== hotel.businessDate) {
        throw failure(409, errorTexts.arrivesOn(stay.arrival, hotel.businessDate));
      }
      const segments = await segmentsOf(pool, stay.id);
      const segment = roomForNight(segments, hotel.businessDate);
      const room = segment ? await loadRoom(pool, hotel.id, segment.roomId) : null;
      if (!room) throw notFoundError();
      if (!readyForCheckIn(room.status)) {
        throw failure(
          409,
          errorTexts.roomNotReadyForCheckIn(room.number, roomStatusWords(room.status)),
        );
      }
      const view = await withTransaction(async (db) => {
        await db.query(
          "update stays set status = 'in_house', check_in_night = $2 where id = $1",
          [stay.id, currentNight(hotel)],
        );
        await endLink(db, stay.id);
        await bumpVersion(db, stay.id);
        const record = await loadStayRecord(db, hotel.id, stay.id);
        const built = await buildStayView(db, hotel, record as StayRecord);
        await publishStayChange(db, hotel, {
          type: 'stay',
          stayId: stay.id,
          notice: notices.checkedIn(built.guest.name, room.number),
          roomIds: [room.id],
        });
        return built;
      });
      return { status: 200, json: view };
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/stays/:id/check-out',
    access: DESK_ROLES,
    bodyMode: 'json',
    handler: async (ctx) => {
      const hotel = await hotelOf(ctx);
      const stay = await requireStay(hotel, ctx.params.id);
      if (!mayCheckOut(stay.status)) throw failure(409, errorTexts.cannotCheckOut);
      if (stay.departure > hotel.businessDate) {
        throw failure(409, errorTexts.departsLater(stay.departure));
      }
      const segments = await segmentsOf(pool, stay.id);
      const lastSegment = segments[segments.length - 1];
      const room = lastSegment ? await loadRoom(pool, hotel.id, lastSegment.roomId) : null;
      if (!room) throw notFoundError();
      const view = await withTransaction(async (db) => {
        await db.query("update stays set status = 'checked_out' where id = $1", [stay.id]);
        await setRoomStatus(db, room.id, 'dirty');
        await bumpVersion(db, stay.id);
        const record = await loadStayRecord(db, hotel.id, stay.id);
        const built = await buildStayView(db, hotel, record as StayRecord);
        await publishStayChange(db, hotel, {
          type: 'stay',
          stayId: stay.id,
          notice: notices.checkedOut(built.guest.name, room.number),
          roomIds: [room.id],
        });
        return built;
      });
      return { status: 200, json: view };
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/stays/:id/cancel',
    access: DESK_ROLES,
    bodyMode: 'json',
    handler: async (ctx) => {
      const hotel = await hotelOf(ctx);
      const stay = await requireStay(hotel, ctx.params.id);
      if (!mayCancel(stay.status)) throw failure(409, errorTexts.cannotCancel);
      const view = await withTransaction(async (db) => {
        const segments = await segmentsOf(db, stay.id);
        const taxRates = await listTaxRates(db, hotel.id);
        const nightly = completeNights(
          await storedNights(db, stay.id),
          segments,
          stay.guests,
          taxRates,
        );
        const terms = cancellationFor(hotel, stay.status, stay.arrival, nightly);
        const feeCents = terms ? terms.feeCents : 0;
        if (feeCents > 0) {
          const guest = await guestOf(db, stay.guestId);
          const folio = await firstOpenFolio(db, stay.id, guest.name, guest.email);
          await insertEntry(db, {
            folioId: folio.id,
            kind: 'charge',
            date: hotel.businessDate,
            description: entryDescriptions.lateCancellationFee,
            amountCents: feeCents,
          });
        }
        await db.query("update stays set status = 'cancelled' where id = $1", [stay.id]);
        await endLink(db, stay.id);
        await bumpVersion(db, stay.id);
        const record = await loadStayRecord(db, hotel.id, stay.id);
        const built = await buildStayView(db, hotel, record as StayRecord);
        await publishStayChange(db, hotel, {
          type: 'stay',
          stayId: stay.id,
          notice: notices.cancelled(built.guest.name, feeCents),
          roomIds: [...new Set(segments.map((segment) => segment.roomId))],
        });
        return built;
      });
      return { status: 200, json: view };
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/stays/:id/checkin-link',
    access: DESK_ROLES,
    bodyMode: 'json',
    handler: async (ctx) => {
      const hotel = await hotelOf(ctx);
      const stay = await requireStay(hotel, ctx.params.id);
      if (!awaitingOnlineCheckIn(stay.status) || stay.checkedInOnline) {
        throw failure(409, errorTexts.linkClosed);
      }
      const guest = await guestOf(pool, stay.guestId);
      try {
        await deliverCheckinLink(hotel, stay.id, guest.email, originOf(ctx.req));
      } catch (error) {
        if (error instanceof ProviderDownError) {
          throw failure(503, outageTexts.checkinLinkMail);
        }
        throw error;
      }
      await publishStayChange(pool, hotel, {
        type: 'stay',
        stayId: stay.id,
        notice: notices.linkSent(guest.name),
      });
      const view = await loadStayView(pool, hotel, stay.id);
      return { status: 200, json: view };
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/stays/:id/id-photo',
    access: DESK_ROLES,
    bodyMode: 'none',
    handler: async (ctx) => {
      const hotel = await hotelOf(ctx);
      const stay = await requireStay(hotel, ctx.params.id);
      if (stay.idPhoto !== 'received') throw notFoundError();
      try {
        const stored = await getObject(idPhotoObjectKey(hotel.id, stay.id));
        if (!stored) throw notFoundError();
        return { status: 200, body: stored.body, contentType: stored.contentType };
      } catch (error) {
        if (error instanceof ProviderDownError) throw failure(503, outageTexts.fileStoreRead);
        throw error;
      }
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/stays/:id/folios',
    access: DESK_ROLES,
    bodyMode: 'json',
    handler: async (ctx) => {
      const hotel = await hotelOf(ctx);
      const stay = await requireStay(hotel, ctx.params.id);
      const payerName = textField(ctx.body, 'payerName');
      const payerEmail = textField(ctx.body, 'payerEmail');
      if (!isValidPayerEmail(payerEmail)) {
        throw invalid({ payerEmail: validationTexts.payerEmail });
      }
      const folio = await withTransaction(async (db) => {
        const created = await createFolio(db, stay.id, payerName, payerEmail);
        await publishStayChange(db, hotel, { type: 'stay', stayId: stay.id, notice: null });
        return created;
      });
      return {
        status: 201,
        json: {
          id: folio.id,
          name: folio.name,
          payerName: folio.payerName,
          payerEmail: folio.payerEmail,
          state: folio.state,
          balanceCents: 0,
          entries: [],
          invoice: null,
        },
      };
    },
  });
}

async function createStay(
  body: Record<string, unknown>,
  hotel: Hotel,
  origin: string,
): Promise<unknown> {
  const guestId = optionalText(body, 'guestId');
  const draft = readGuestDraft(body);
  const errors: Record<string, string> = {
    ...checkDates(hotel, body.arrival, body.departure, { inHouse: false }),
    ...checkGuestCount(body.guests),
    ...(await checkRoom(pool, hotel, body.roomId)),
    ...(await checkRatePlan(pool, hotel, body.ratePlanId)),
  };
  if (guestId === null) {
    Object.assign(errors, checkGuestDraft(draft ?? { name: '', email: '', phone: '' }));
  }
  if (Object.keys(errors).length > 0) throw invalid(errors);

  const arrival = dateField(body, 'arrival') as PlainDate;
  const departure = dateField(body, 'departure') as PlainDate;
  const guests = integerField(body, 'guests') as number;
  const roomId = textField(body, 'roomId');
  const ratePlanId = textField(body, 'ratePlanId');

  const existingGuest = guestId !== null ? await loadGuest(pool, hotel.id, guestId) : null;
  if (guestId !== null && !existingGuest) throw notFoundError();

  const created = await withTransaction(async (db: PoolClient) => {
    const room = await loadRoom(db, hotel.id, roomId);
    if (!room) throw notFoundError();
    await lockRooms(db, [roomId]);
    const nights = dateRange(arrival, daysBetween(arrival, departure));
    await refuseHeldNights(db, roomId, nights, null, room.number, true);

    const guest =
      existingGuest ??
      (await findGuestByEmail(db, hotel.id, (draft as { email: string }).email)) ??
      (await createGuest(db, hotel.id, draft as { name: string; email: string; phone: string }));

    const stayId = randomUUID();
    await db.query(
      `insert into stays (id, hotel_id, guest_id, rate_plan_id, guests, arrival, departure, status)
       values ($1,$2,$3,$4,$5,$6,$7,'booked')`,
      [stayId, hotel.id, guest.id, ratePlanId, guests, arrival, departure],
    );
    await replaceSegments(db, stayId, [{ roomId, firstNight: arrival, nights: nights.length }]);
    const plan = await ratePlanFor(db, hotel, ratePlanId);
    if (plan) await writeRoomNights(db, stayId, plan, arrival, departure, guests);
    await createFolio(db, stayId, guest.name, guest.email);
    await publishStayChange(db, hotel, {
      type: 'stay',
      stayId,
      notice: notices.stayCreated(guest.name, room.number),
      roomIds: [roomId],
    });
    return { stayId, guestEmail: guest.email };
  });

  try {
    await deliverCheckinLink(hotel, created.stayId, created.guestEmail, origin);
  } catch (error) {
    if (!(error instanceof ProviderDownError)) throw error;
  }
  return loadStayView(pool, hotel, created.stayId);
}
