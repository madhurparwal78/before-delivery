import { addDays, isDate, isMonth } from '../../shared/calendar.js';
import { blockLabelOf } from '../../shared/format.js';
import { config } from '../config.js';
import { db, lock, transact, type Queryable } from '../db/pool.js';
import { bookingDocumentRefusal, checkInDocumentRefusal } from '../domain/documents.js';
import { halfOf } from '../domain/rates.js';
import { localDateOf, localMonthOf } from '../domain/time.js';
import { transitionAllowed, type Actor } from '../domain/transitions.js';
import type { BookingRow, Kitchen, Station } from '../domain/types.js';
import { requireRole, type RequestContext, type SignedContext } from '../http/context.js';
import { errors, fieldCopy, type TakenEntry } from '../http/errors.js';
import { withIdempotency } from '../http/idempotency.js';
import { json, type Result } from '../http/respond.js';
import { priceBlock, shelfDates, validateHourly, validateShelf, type Block } from '../api/blocks.js';
import { applyDueLapse, bookingContext } from '../api/bookingView.js';
import {
  cancellationMessage,
  confirmationMessage,
  moveMessage,
  queueMail,
  waiverMessage,
} from '../api/emails.js';
import { bookingObject, hourBank } from '../api/shapes.js';
import { asInteger, asString, exactBody, FieldErrors } from '../api/validate.js';
import { flushMailNow, flushMemberQuietly } from '../services/outbox.js';
import {
  applyMove,
  insertHold,
  loadBooking,
  loadSeries,
  monthBookings,
  overlappingHourly,
  setStatus,
  setWaived,
  shelfOccupancy,
  stationWindows,
} from '../store/bookings.js';
import { memberDocuments } from '../store/documents.js';
import { loadMember } from '../store/kitchens.js';
import {
  balanceQuarters,
  itemsForBooking,
  recordCancellation,
  recordConfirm,
  recordMoveIn,
  recordMoveOut,
  recordPenalty,
  recordWaiver,
  usedQuarters,
} from '../store/ledger.js';
import { closedMonths, earliestOpenMonth, isMonthClosed } from '../store/months.js';
import { loadStation, loadStations } from '../store/stations.js';

const cutoffMs = 48 * 60 * 60 * 1000;

function actorOf(context: SignedContext): Actor {
  return { role: context.person.role, memberId: context.person.memberId };
}

function nextMonth(month: string): string {
  const year = Number.parseInt(month.slice(0, 4), 10);
  const index = Number.parseInt(month.slice(5, 7), 10);
  return index === 12 ? `${year + 1}-01` : `${year}-${(index + 1).toString().padStart(2, '0')}`;
}

async function lockMonths(client: Queryable, kitchenId: string, months: string[]): Promise<void> {
  for (const month of [...new Set(months)].sort()) {
    await lock(client, 'monthClose', `${kitchenId}:${month}`);
  }
}

async function lockHours(client: Queryable, memberId: string, months: string[]): Promise<void> {
  for (const month of [...new Set(months)].sort()) {
    await lock(client, 'memberMonthHours', `${memberId}:${month}`);
  }
}

/** Resolves a booking in the caller's kitchen, hiding other members' ids. */
async function resolveBooking(
  context: RequestContext,
  bookingId: string,
): Promise<BookingRow> {
  const signedContext = context as SignedContext;
  const booking = await loadBooking(db(), signedContext.kitchen.id, bookingId);
  if (!booking) throw errors.notFound();
  if (
    signedContext.person.role === 'member' &&
    booking.memberId !== signedContext.person.memberId
  ) {
    throw errors.notFound();
  }
  return booking;
}

function blockOf(booking: BookingRow): Block {
  return {
    stationId: booking.stationId,
    kind: booking.kind,
    localDate: booking.localDate,
    localStart: booking.localStart,
    localEnd: booking.localEnd,
    days: booking.days,
    startMs: booking.startMs,
    endMs: booking.endMs,
    month: booking.month,
    quarterHours: booking.quarterHours,
    peakQuarters: booking.peakQuarters,
    chargeCents: booking.chargeCents,
  };
}

/** Re-prices a booking's own block at the rates and peak windows now in force. */
function repriceBlock(station: Station, kitchen: Kitchen, booking: BookingRow): Block {
  const span = { startMs: booking.startMs, endMs: booking.endMs };
  return station.kind === 'shelf'
    ? priceBlock(
        station,
        kitchen,
        { kind: 'shelf', date: booking.localDate, days: booking.days ?? 1 },
        span,
      )
    : priceBlock(
        station,
        kitchen,
        {
          kind: 'hourly',
          date: booking.localDate,
          start: booking.localStart!,
          end: booking.localEnd!,
        },
        span,
      );
}

async function takenFor(
  client: Queryable,
  station: Station,
  block: Block,
  nowMs: number,
  excludeBookingId: string | null,
): Promise<TakenEntry[]> {
  if (station.kind === 'hourly') {
    const clashes = await overlappingHourly(
      client,
      station.id,
      block.startMs,
      block.endMs,
      nowMs,
      excludeBookingId,
    );
    return clashes.length === 0
      ? []
      : [
          {
            stationId: station.id,
            stationName: station.name,
            date: block.localDate,
            start: block.localStart,
            end: block.localEnd,
          },
        ];
  }
  const dates = shelfDates(block.localDate, block.days ?? 1);
  const counts = await shelfOccupancy(client, station.id, dates, nowMs, excludeBookingId);
  return dates
    .filter((date) => (counts.get(date) ?? 0) >= (station.capacity ?? 0))
    .map((date) => ({
      stationId: station.id,
      stationName: station.name,
      date,
      start: null,
      end: null,
    }));
}

async function overlapsWindow(
  client: Queryable,
  stationId: string,
  startMs: number,
  endMs: number,
): Promise<boolean> {
  const windows = await stationWindows(client, stationId);
  return windows.some((window) => window.startMs < endMs && window.endMs > startMs);
}

async function documentRefusal(
  client: Queryable,
  kitchen: Kitchen,
  memberId: string,
  blockEndMs: number,
): Promise<string | null> {
  const documents = await memberDocuments(client, memberId);
  const refusal = bookingDocumentRefusal(
    documents,
    kitchen.requiredDocuments,
    kitchen.timeZone,
    blockEndMs,
  );
  if (!refusal) return null;
  return refusal.reason === 'missing'
    ? fieldCopy.documentMissing(refusal.type)
    : fieldCopy.documentExpiresFirst(refusal.type, (refusal as { date: string }).date);
}

/** The hour check: the balance at the request's turn, month by month in ascending order. */
async function hoursRefusal(
  client: Queryable,
  memberId: string,
  allowanceQuarters: number,
  needed: Map<string, number>,
  returnedByMonth: Map<string, number>,
): Promise<string | null> {
  for (const month of [...needed.keys()].sort()) {
    const quarters = needed.get(month)!;
    if (quarters === 0) continue;
    const balance =
      (await balanceQuarters(client, memberId, month, allowanceQuarters)) +
      (returnedByMonth.get(month) ?? 0);
    if (quarters > balance) {
      return fieldCopy.notEnoughHours(quarters / 4, balance / 4, month);
    }
  }
  return null;
}

/** POST /api/bookings */
export async function holdBlocks(context: RequestContext): Promise<Result> {
  const signedContext = context as SignedContext;
  const body = (signedContext.json ?? {}) as Record<string, unknown>;
  const stationId = asString(body['stationId']);
  const station = stationId
    ? await loadStation(db(), signedContext.kitchen.id, stationId)
    : null;
  if (stationId !== null && station === null) throw errors.notFound();
  requireRole(signedContext, ['member']);

  return withIdempotency(signedContext, async () => {
    const kitchen = signedContext.kitchen;
    const shelf = station?.kind === 'shelf';
    const parsed = exactBody(
      signedContext.json,
      shelf ? ['stationId', 'date', 'days'] : ['stationId', 'date', 'start', 'end'],
      shelf ? ['notes'] : ['repeatWeeks', 'notes'],
    );
    const fieldErrors = new FieldErrors();
    const date = asString(parsed['date']);
    if (date === null || !isDate(date)) fieldErrors.add('date', fieldCopy.date);
    const notes = parsed['notes'] === undefined ? '' : asString(parsed['notes']);
    if (notes === null || [...notes].length > 500) fieldErrors.add('notes', fieldCopy.notes);

    let weeks = 1;
    let days = 1;
    if (shelf) {
      const requested = asInteger(parsed['days']);
      if (requested === null || requested < 1 || requested > 31) {
        fieldErrors.add('days', fieldCopy.days);
      } else days = requested;
    } else {
      const requested = parsed['repeatWeeks'] === undefined ? 1 : asInteger(parsed['repeatWeeks']);
      if (requested === null || requested < 1 || requested > 12) {
        fieldErrors.add('repeatWeeks', fieldCopy.repeatWeeks);
      } else weeks = requested;
    }
    fieldErrors.throwIfAny();

    const nowMs = signedContext.nowMs;
    const blocks: Block[] = [];
    for (let week = 0; week < weeks; week += 1) {
      const weekDate = addDays(date!, week * 7);
      const weekErrors = new FieldErrors();
      if (shelf) {
        const span = validateShelf(weekErrors, kitchen, nowMs, { date: weekDate, days });
        weekErrors.throwIfAny();
        blocks.push(
          priceBlock(station!, kitchen, { kind: 'shelf', date: weekDate, days }, span!),
        );
      } else {
        const start = asString(parsed['start']) ?? '';
        const end = asString(parsed['end']) ?? '';
        const span = validateHourly(weekErrors, kitchen, nowMs, { date: weekDate, start, end });
        weekErrors.throwIfAny();
        blocks.push(
          priceBlock(station!, kitchen, { kind: 'hourly', date: weekDate, start, end }, span!),
        );
      }
    }

    const memberId = signedContext.person.memberId!;
    const seriesId = weeks > 1 ? `ser_${nowMs}_${memberId}_${blocks[0]!.startMs}` : null;

    const created = await transact(async (client) => {
      await lockMonths(client, kitchen.id, blocks.map((block) => block.month));
      await lock(client, 'station', station!.id);

      const closed = new Set(await closedMonths(client, kitchen.id));
      for (const block of blocks) {
        if (closed.has(block.month)) throw errors.monthClosed(block.month);
      }

      const taken: TakenEntry[] = [];
      for (const block of blocks) {
        taken.push(...(await takenFor(client, station!, block, nowMs, null)));
      }
      if (taken.length > 0) throw errors.blockTaken(taken);

      const stateErrors = new FieldErrors();
      for (const block of blocks) {
        if (await overlapsWindow(client, station!.id, block.startMs, block.endMs)) {
          stateErrors.add('stationId', fieldCopy.outOfService(station!.name));
          break;
        }
      }
      for (const block of blocks) {
        const refusal = await documentRefusal(client, kitchen, memberId, block.endMs);
        if (refusal) {
          stateErrors.add('documents', refusal);
          break;
        }
      }
      const member = (await loadMember(client, kitchen.id, memberId))!;
      const needed = new Map<string, number>();
      for (const block of blocks) {
        needed.set(block.month, (needed.get(block.month) ?? 0) + block.quarterHours);
      }
      const refusal = await hoursRefusal(
        client,
        memberId,
        member.allowanceQuarters,
        needed,
        new Map(),
      );
      if (refusal) stateErrors.add('hours', refusal);
      stateErrors.throwIfAny();

      const rows: BookingRow[] = [];
      for (const block of blocks) {
        rows.push(
          await insertHold(client, {
            ...block,
            kitchenId: kitchen.id,
            memberId,
            notes: notes!,
            seriesId,
            holdExpiresAtMs: nowMs + config.holdTtlSeconds * 1000,
          }),
        );
      }
      return rows;
    });

    const view = await bookingContext(db(), kitchen, actorOf(signedContext), nowMs);
    return json(201, {
      bookings: created.map((booking) => bookingObject(booking, view)),
      seriesId,
    });
  });
}

/** POST /api/bookings/{id}/confirm */
export async function confirmBooking(
  context: RequestContext,
  bookingId: string,
): Promise<Result> {
  const existing = await resolveBooking(context, bookingId);
  const signedContext = requireRole(context, ['member']);
  const kitchen = signedContext.kitchen;

  return withIdempotency(signedContext, async () => {
    exactBody(signedContext.json, []);
    const nowMs = signedContext.nowMs;
    const stations = await loadStations(db(), kitchen.id);
    const memberId = signedContext.person.memberId!;

    const outcome = await transact(async (client) => {
      const siblings = existing.seriesId
        ? await loadSeries(client, existing.seriesId)
        : [existing];
      await lockMonths(client, kitchen.id, siblings.map((week) => week.month));
      await lock(client, 'station', existing.stationId);
      await lockHours(client, memberId, siblings.map((week) => week.month));

      const closed = new Set(await closedMonths(client, kitchen.id));
      const fresh = (await loadBooking(client, kitchen.id, bookingId))!;
      const booking = await applyDueLapse(client, fresh, nowMs, closed.has(fresh.month));
      const station = stations.find((candidate) => candidate.id === booking.stationId)!;

      if (closed.has(booking.month)) throw errors.monthClosed(booking.month);

      if (booking.status === 'expired') {
        const taken = await takenFor(client, station, blockOf(booking), nowMs, booking.id);
        if (taken.length > 0) throw errors.blockTaken(taken);
        throw errors.holdExpired(blockLabelOf({ ...booking, stationName: station.name }));
      }
      if (!transitionAllowed('confirm', booking, actorOf(signedContext), nowMs)) {
        const view = await bookingContext(client, kitchen, actorOf(signedContext), nowMs);
        throw errors.invalidTransitionBooking(
          booking.status,
          'confirm',
          bookingObject(booking, view),
        );
      }

      const weeks = existing.seriesId
        ? (await loadSeries(client, existing.seriesId)).filter(
            (week) => week.status === 'held' || week.id === booking.id,
          )
        : [booking];
      const repriced = weeks.map((week) => {
        const weekStation = stations.find((candidate) => candidate.id === week.stationId)!;
        return { week, station: weekStation, block: repriceBlock(weekStation, kitchen, week) };
      });

      const stateErrors = new FieldErrors();
      for (const entry of repriced) {
        if (await overlapsWindow(client, entry.week.stationId, entry.block.startMs, entry.block.endMs)) {
          stateErrors.add('stationId', fieldCopy.outOfService(entry.station.name));
          break;
        }
      }
      for (const entry of repriced) {
        const refusal = await documentRefusal(client, kitchen, memberId, entry.block.endMs);
        if (refusal) {
          stateErrors.add('documents', refusal);
          break;
        }
      }
      const member = (await loadMember(client, kitchen.id, memberId))!;
      const needed = new Map<string, number>();
      for (const entry of repriced) {
        needed.set(
          entry.block.month,
          (needed.get(entry.block.month) ?? 0) + entry.block.quarterHours,
        );
      }
      const refusal = await hoursRefusal(
        client,
        memberId,
        member.allowanceQuarters,
        needed,
        new Map(),
      );
      if (refusal) stateErrors.add('hours', refusal);
      stateErrors.throwIfAny();

      const confirmed: BookingRow[] = [];
      for (const entry of repriced) {
        const priced = await applyMove(client, entry.week.id, {
          ...entry.block,
          conflict: entry.week.conflict,
        });
        const row = await setStatus(client, priced.id, 'confirmed', { confirmedAtMs: nowMs });
        await recordConfirm(client, row, entry.station.name, localDateOf(kitchen.timeZone, nowMs));
        const balance =
          member.allowanceQuarters - (await usedQuarters(client, memberId, row.month));
        await queueMail(
          client,
          confirmationMessage({
            to: member.email,
            business: member.businessName,
            blockLabel: blockLabelOf({ ...row, stationName: entry.station.name }),
            bookingId: row.id,
            chargeCents: row.chargeCents,
            month: row.month,
            hourly: row.kind === 'hourly',
            balanceHours: Math.max(0, balance) / 4,
          }),
        );
        confirmed.push(row);
      }
      return { confirmed, month: booking.month, member };
    });

    void flushMailNow();
    await flushMemberQuietly(outcome.member.id, 5000);

    const view = await bookingContext(db(), kitchen, actorOf(signedContext), nowMs);
    const rows: BookingRow[] = [];
    for (const booking of outcome.confirmed) {
      rows.push((await loadBooking(db(), kitchen.id, booking.id))!);
    }
    const pending = await anyPending(rows.map((row) => row.id));
    const used = await usedQuarters(db(), outcome.member.id, outcome.month);
    return json(pending ? 202 : 200, {
      bookings: rows.map((booking) => bookingObject(booking, view)),
      hourBank: hourBank(outcome.month, outcome.member.allowanceQuarters, used),
    });
  });
}

async function anyPending(bookingIds: string[]): Promise<boolean> {
  for (const bookingId of bookingIds) {
    const items = await itemsForBooking(db(), bookingId);
    if (items.some((item) => !item.recorded)) return true;
  }
  return false;
}

/** GET /api/bookings */
export async function listBookings(context: RequestContext): Promise<Result> {
  const signedContext = requireRole(context, ['member', 'operator', 'shift_lead']);
  const kitchen = signedContext.kitchen;
  const requested = signedContext.query.get('month');
  if (requested !== null && !isMonth(requested)) {
    throw errors.validationFailed({ month: fieldCopy.month });
  }
  const month = requested ?? localMonthOf(kitchen.timeZone, signedContext.nowMs);
  const memberId =
    signedContext.person.role === 'member'
      ? signedContext.person.memberId
      : signedContext.query.get('memberId');

  const bookings = await monthBookings(
    db(),
    kitchen.id,
    month,
    memberId,
    signedContext.nowMs,
  );
  const closed = new Set(await closedMonths(db(), kitchen.id));
  const settled = await transact(async (client) => {
    const rows: BookingRow[] = [];
    for (const booking of bookings) {
      rows.push(
        await applyDueLapse(client, booking, signedContext.nowMs, closed.has(booking.month)),
      );
    }
    return rows;
  });
  const view = await bookingContext(db(), kitchen, actorOf(signedContext), signedContext.nowMs);
  return json(200, {
    month,
    bookings: settled
      .filter((booking) => booking.confirmedAtMs !== null || booking.status === 'held')
      .map((booking) => bookingObject(booking, view)),
  });
}

/** GET /api/bookings/{id} */
export async function getBooking(context: RequestContext, bookingId: string): Promise<Result> {
  const booking = await resolveBooking(context, bookingId);
  const signedContext = requireRole(context, ['member', 'operator', 'shift_lead']);
  const kitchen = signedContext.kitchen;
  const closed = new Set(await closedMonths(db(), kitchen.id));
  const settled = await transact((client) =>
    applyDueLapse(client, booking, signedContext.nowMs, closed.has(booking.month)),
  );
  const view = await bookingContext(db(), kitchen, actorOf(signedContext), signedContext.nowMs);
  return json(200, { booking: bookingObject(settled, view) });
}

/** POST /api/bookings/{id}/cancel */
export async function cancelBooking(context: RequestContext, bookingId: string): Promise<Result> {
  const existing = await resolveBooking(context, bookingId);
  const signedContext = requireRole(context, ['member', 'operator']);
  const kitchen = signedContext.kitchen;

  return withIdempotency(signedContext, async () => {
    exactBody(signedContext.json, []);
    const nowMs = signedContext.nowMs;
    const stations = await loadStations(db(), kitchen.id);

    const outcome = await transact(async (client) => {
      await lockMonths(client, kitchen.id, [existing.month]);
      await lock(client, 'booking', existing.id);
      const closed = new Set(await closedMonths(client, kitchen.id));
      const fresh = (await loadBooking(client, kitchen.id, bookingId))!;
      const booking = await applyDueLapse(client, fresh, nowMs, closed.has(fresh.month));
      if (closed.has(booking.month)) throw errors.monthClosed(booking.month);
      if (!transitionAllowed('cancel', booking, actorOf(signedContext), nowMs)) {
        const view = await bookingContext(client, kitchen, actorOf(signedContext), nowMs);
        throw errors.invalidTransitionBooking(
          booking.status,
          'cancel',
          bookingObject(booking, view),
        );
      }
      const member = (await loadMember(client, kitchen.id, booking.memberId))!;

      if (booking.status === 'held') {
        const released = await setStatus(client, booking.id, 'cancelled_free');
        return { booking: released, member, billed: false };
      }

      await lockHours(client, booking.memberId, [booking.month]);
      const station = stations.find((candidate) => candidate.id === booking.stationId)!;
      const filedDate = localDateOf(kitchen.timeZone, nowMs);
      const late = nowMs > booking.startMs - cutoffMs;
      const penaltyCents = late ? halfOf(booking.chargeCents) : 0;
      if (late) await recordPenalty(client, booking, penaltyCents, filedDate);
      await recordCancellation(client, booking, filedDate);
      const cancelled = await setStatus(
        client,
        booking.id,
        late ? 'cancelled_late' : 'cancelled_free',
        { penaltyCents },
      );
      await queueMail(
        client,
        cancellationMessage({
          to: member.email,
          business: member.businessName,
          blockLabel: blockLabelOf({ ...booking, stationName: station.name }),
          bookingId: booking.id,
          penaltyCents,
        }),
      );
      return { booking: cancelled, member, billed: true };
    });

    if (outcome.billed) {
      void flushMailNow();
      await flushMemberQuietly(outcome.member.id, 2000);
    }
    const view = await bookingContext(db(), kitchen, actorOf(signedContext), nowMs);
    const used = await usedQuarters(db(), outcome.member.id, outcome.booking.month);
    const booking = (await loadBooking(db(), kitchen.id, bookingId))!;
    return json(200, {
      booking: bookingObject(booking, view),
      hourBank: hourBank(outcome.booking.month, outcome.member.allowanceQuarters, used),
    });
  });
}

/** POST /api/bookings/{id}/release */
export async function releaseBooking(context: RequestContext, bookingId: string): Promise<Result> {
  const existing = await resolveBooking(context, bookingId);
  const signedContext = requireRole(context, ['shift_lead', 'operator']);
  const kitchen = signedContext.kitchen;
  exactBody(signedContext.json, []);
  const nowMs = signedContext.nowMs;
  const stations = await loadStations(db(), kitchen.id);

  const outcome = await transact(async (client) => {
    await lockMonths(client, kitchen.id, [existing.month]);
    await lock(client, 'booking', existing.id);
    const closed = new Set(await closedMonths(client, kitchen.id));
    const fresh = (await loadBooking(client, kitchen.id, bookingId))!;
    const booking = await applyDueLapse(client, fresh, nowMs, closed.has(fresh.month));
    if (closed.has(booking.month)) throw errors.monthClosed(booking.month);
    if (!transitionAllowed('release', booking, actorOf(signedContext), nowMs)) {
      const view = await bookingContext(client, kitchen, actorOf(signedContext), nowMs);
      throw errors.invalidTransitionBooking(
        booking.status,
        'release',
        bookingObject(booking, view),
      );
    }
    await lockHours(client, booking.memberId, [booking.month]);
    const member = (await loadMember(client, kitchen.id, booking.memberId))!;
    const station = stations.find((candidate) => candidate.id === booking.stationId)!;
    await recordCancellation(client, booking, localDateOf(kitchen.timeZone, nowMs));
    const released = await setStatus(client, booking.id, 'cancelled_free', { conflict: false });
    await queueMail(
      client,
      cancellationMessage({
        to: member.email,
        business: member.businessName,
        blockLabel: blockLabelOf({ ...booking, stationName: station.name }),
        bookingId: booking.id,
        penaltyCents: 0,
      }),
    );
    return { booking: released, member };
  });

  void flushMailNow();
  await flushMemberQuietly(outcome.member.id, 2000);
  const view = await bookingContext(db(), kitchen, actorOf(signedContext), nowMs);
  const used = await usedQuarters(db(), outcome.member.id, outcome.booking.month);
  return json(200, {
    booking: bookingObject(outcome.booking, view),
    hourBank: hourBank(outcome.booking.month, outcome.member.allowanceQuarters, used),
  });
}

/** POST /api/bookings/{id}/check-in | check-out | no-show */
export async function statusAction(
  context: RequestContext,
  bookingId: string,
  action: 'check_in' | 'check_out' | 'no_show',
): Promise<Result> {
  const existing = await resolveBooking(context, bookingId);
  const signedContext = requireRole(context, ['shift_lead', 'operator']);
  const kitchen = signedContext.kitchen;
  exactBody(signedContext.json, []);
  const nowMs = signedContext.nowMs;

  const updated = await transact(async (client) => {
    await lockMonths(client, kitchen.id, [existing.month]);
    await lock(client, 'booking', existing.id);
    const closed = new Set(await closedMonths(client, kitchen.id));
    const fresh = (await loadBooking(client, kitchen.id, bookingId))!;
    const booking = await applyDueLapse(client, fresh, nowMs, closed.has(fresh.month));
    if (closed.has(booking.month)) throw errors.monthClosed(booking.month);
    if (!transitionAllowed(action, booking, actorOf(signedContext), nowMs)) {
      const view = await bookingContext(client, kitchen, actorOf(signedContext), nowMs);
      throw errors.invalidTransitionBooking(booking.status, action, bookingObject(booking, view));
    }
    if (action === 'check_in') {
      const documents = await memberDocuments(client, booking.memberId);
      const refusal = checkInDocumentRefusal(
        documents,
        kitchen.requiredDocuments,
        kitchen.timeZone,
        nowMs,
      );
      if (refusal) {
        throw errors.validationFailed({
          documents:
            refusal.reason === 'check_in_missing'
              ? fieldCopy.checkInNoDocument(refusal.type)
              : fieldCopy.checkInExpired(refusal.type, (refusal as { date: string }).date),
        });
      }
    }
    const target =
      action === 'check_in' ? 'checked_in' : action === 'check_out' ? 'completed' : 'no_show';
    return setStatus(client, booking.id, target);
  });

  const view = await bookingContext(db(), kitchen, actorOf(signedContext), nowMs);
  return json(200, { booking: bookingObject(updated, view) });
}

/** POST /api/bookings/{id}/move */
export async function moveBooking(context: RequestContext, bookingId: string): Promise<Result> {
  const existing = await resolveBooking(context, bookingId);
  const signedContext = context as SignedContext;
  const kitchen = signedContext.kitchen;
  const body = (signedContext.json ?? {}) as Record<string, unknown>;
  const stationId = asString(body['stationId']);
  const target = stationId ? await loadStation(db(), kitchen.id, stationId) : null;
  if (stationId !== null && target === null) throw errors.notFound();
  requireRole(signedContext, ['shift_lead', 'operator']);

  const shelf = target?.kind === 'shelf';
  const parsed = exactBody(
    signedContext.json,
    shelf
      ? ['stationId', 'date', 'days', 'version']
      : ['stationId', 'date', 'start', 'end', 'version'],
  );

  const fieldErrors = new FieldErrors();
  const version = asInteger(parsed['version']);
  if (version === null) fieldErrors.add('version', fieldCopy.version);
  const date = asString(parsed['date']);
  if (date === null || !isDate(date)) fieldErrors.add('date', fieldCopy.date);
  if (target!.kind !== existing.kind) {
    throw errors.validationFailed({ stationId: fieldCopy.wrongKind });
  }
  let days = 1;
  if (shelf) {
    const requested = asInteger(parsed['days']);
    if (requested === null || requested < 1 || requested > 31) {
      fieldErrors.add('days', fieldCopy.days);
    } else days = requested;
  }
  fieldErrors.throwIfAny();

  const nowMs = signedContext.nowMs;
  const request = shelf
    ? ({ kind: 'shelf', date: date!, days } as const)
    : ({
        kind: 'hourly',
        date: date!,
        start: asString(parsed['start']) ?? '',
        end: asString(parsed['end']) ?? '',
      } as const);
  const blockErrors = new FieldErrors();
  const span =
    request.kind === 'shelf'
      ? validateShelf(blockErrors, kitchen, nowMs, { date: request.date, days: request.days })
      : validateHourly(blockErrors, kitchen, nowMs, request);
  blockErrors.throwIfAny();
  const block = priceBlock(target!, kitchen, request, span!);

  const stations = await loadStations(db(), kitchen.id);
  const outcome = await transact(async (client) => {
    await lockMonths(client, kitchen.id, [existing.month, block.month]);
    for (const id of [existing.stationId, target!.id].sort()) {
      await lock(client, 'station', id);
    }
    await lock(client, 'booking', existing.id);

    const closed = new Set(await closedMonths(client, kitchen.id));
    const fresh = (await loadBooking(client, kitchen.id, bookingId))!;
    const booking = await applyDueLapse(client, fresh, nowMs, closed.has(fresh.month));
    const view = await bookingContext(client, kitchen, actorOf(signedContext), nowMs);

    if (booking.version !== version) throw errors.staleVersionMove(bookingObject(booking, view));
    if (closed.has(booking.month)) throw errors.monthClosed(booking.month);
    if (closed.has(block.month)) throw errors.monthClosed(block.month);
    if (!transitionAllowed('move', booking, actorOf(signedContext), nowMs)) {
      throw errors.invalidTransitionBooking(booking.status, 'move', bookingObject(booking, view));
    }
    const taken = await takenFor(client, target!, block, nowMs, booking.id);
    if (taken.length > 0) throw errors.blockTaken(taken);

    const stateErrors = new FieldErrors();
    if (await overlapsWindow(client, target!.id, block.startMs, block.endMs)) {
      stateErrors.add('stationId', fieldCopy.outOfService(target!.name));
    }
    await lockHours(client, booking.memberId, [booking.month, block.month]);
    const member = (await loadMember(client, kitchen.id, booking.memberId))!;
    const refusal = await hoursRefusal(
      client,
      booking.memberId,
      member.allowanceQuarters,
      new Map([[block.month, block.quarterHours]]),
      new Map([[booking.month, booking.quarterHours]]),
    );
    if (refusal) stateErrors.add('hours', refusal);
    stateErrors.throwIfAny();

    const oldStation = stations.find((candidate) => candidate.id === booking.stationId)!;
    const oldLabel = blockLabelOf({ ...booking, stationName: oldStation.name });
    const filedDate = localDateOf(kitchen.timeZone, nowMs);
    await recordMoveOut(client, booking, filedDate);
    const windows = await stationWindows(client, target!.id);
    const conflict = windows.some(
      (window) => window.startMs < block.endMs && window.endMs > block.startMs,
    );
    const moved = await applyMove(client, booking.id, { ...block, conflict });
    await recordMoveIn(client, moved, target!.name, filedDate);
    await queueMail(
      client,
      moveMessage({
        to: member.email,
        business: member.businessName,
        oldLabel,
        newLabel: blockLabelOf({ ...moved, stationName: target!.name }),
        chargeCents: moved.chargeCents,
      }),
    );
    return { booking: moved, member };
  });

  void flushMailNow();
  await flushMemberQuietly(outcome.member.id, 2000);
  const view = await bookingContext(db(), kitchen, actorOf(signedContext), nowMs);
  const used = await usedQuarters(db(), outcome.member.id, outcome.booking.month);
  const booking = (await loadBooking(db(), kitchen.id, bookingId))!;
  return json(200, {
    booking: bookingObject(booking, view),
    hourBank: hourBank(outcome.booking.month, outcome.member.allowanceQuarters, used),
  });
}

/** POST /api/bookings/{id}/waive-penalty */
export async function waivePenalty(context: RequestContext, bookingId: string): Promise<Result> {
  const existing = await resolveBooking(context, bookingId);
  const signedContext = requireRole(context, ['operator']);
  const kitchen = signedContext.kitchen;

  return withIdempotency(signedContext, async () => {
    exactBody(signedContext.json, []);
    const nowMs = signedContext.nowMs;
    const stations = await loadStations(db(), kitchen.id);

    const outcome = await transact(async (client) => {
      await lock(client, 'booking', existing.id);
      const fresh = (await loadBooking(client, kitchen.id, bookingId))!;
      if (!transitionAllowed('waive_penalty', fresh, actorOf(signedContext), nowMs)) {
        const view = await bookingContext(client, kitchen, actorOf(signedContext), nowMs);
        throw errors.invalidTransitionBooking(
          fresh.status,
          'waive_penalty',
          bookingObject(fresh, view),
        );
      }
      const currentMonth = localMonthOf(kitchen.timeZone, nowMs);
      const feeMonthClosed = await isMonthClosed(client, kitchen.id, fresh.month);
      const creditMonth = feeMonthClosed
        ? await earliestOpenMonth(client, kitchen.id, currentMonth, nextMonth)
        : fresh.month;
      await lockMonths(client, kitchen.id, [creditMonth]);
      const waived = await setWaived(client, fresh.id);
      await recordWaiver(client, fresh, creditMonth, localDateOf(kitchen.timeZone, nowMs));
      const member = (await loadMember(client, kitchen.id, fresh.memberId))!;
      const station = stations.find((candidate) => candidate.id === fresh.stationId)!;
      await queueMail(
        client,
        waiverMessage({
          to: member.email,
          business: member.businessName,
          blockLabel: blockLabelOf({ ...fresh, stationName: station.name }),
          penaltyCents: fresh.penaltyCents,
          creditMonth,
        }),
      );
      return { booking: waived, creditMonth, member };
    });

    void flushMailNow();
    await flushMemberQuietly(outcome.member.id, 2000);
    const view = await bookingContext(db(), kitchen, actorOf(signedContext), nowMs);
    return json(200, {
      booking: bookingObject(outcome.booking, view),
      creditMonth: outcome.creditMonth,
    });
  });
}
