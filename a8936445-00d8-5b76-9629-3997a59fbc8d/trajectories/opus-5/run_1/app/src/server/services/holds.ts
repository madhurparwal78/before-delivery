import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { errors } from '../http/errors.js';
import type { SessionUser } from '../http/context.js';
import { pool, withTransaction } from '../db/pool.js';
import {
  bookingsForHold,
  confirmHoldBookings,
  deleteHold,
  findHold,
  insertBooking,
  insertHold,
  lockHold,
  lockStation,
  lockTenantHours,
  markHoldConfirmed,
  nextHoldRef,
  occupiedSpans,
} from '../db/repo/bookings.js';
import { findStation, listStations } from '../db/repo/catalog.js';
import { listDocuments } from '../db/repo/documents.js';
import { balanceMinutes, recordMovement } from '../db/repo/ledger.js';
import { currentPolicy } from '../db/repo/policy.js';
import { recordStateChange } from '../db/repo/audit.js';
import { conflictingDates, type RequestedSpan } from '../domain/availability.js';
import {
  BOOKING_WINDOW_DAYS,
  CLEANING_BUFFER_MINUTES,
  MAX_HOLD_MINUTES,
  MAX_WEEKS,
  MIN_HOLD_MINUTES,
} from '../domain/constants.js';
import { occurrencesBlockedByExpiry } from '../domain/documents.js';
import { stationTimeCents } from '../domain/money.js';
import {
  addDays,
  currentStepMinute,
  daysBetween,
  isValidDate,
  kitchenToday,
  parseLocalTime,
  resolveLocal,
  resolveLocalOrTransition,
} from '../domain/time.js';
import type { BookingRecord, HoldRecord } from '../domain/types.js';
import { bookingConfirmationEmail } from './emails.js';
import { billingAccountFor, requireTenant, tenantStatusOf } from './tenants.js';
import { inUnitOfWork } from './unitOfWork.js';

export interface PlaceHoldInput {
  stationId: string;
  date: string;
  startLocal: string;
  endLocal: string;
  weeks: number;
  notes: string;
  tenantId: string;
}

export interface HoldWithBookings {
  hold: HoldRecord;
  bookings: BookingRecord[];
}

function occurrenceSpans(
  date: string,
  startMinute: number,
  endMinute: number,
  weeks: number,
): RequestedSpan[] {
  const spans: RequestedSpan[] = [];
  for (let week = 0; week < weeks; week += 1) {
    const occurrenceDate = addDays(date, week * 7);
    spans.push({
      date: occurrenceDate,
      startAt: resolveLocalOrTransition(occurrenceDate, startMinute),
      endAt: resolveLocalOrTransition(occurrenceDate, endMinute),
    });
  }
  return spans;
}

function validatePlacement(input: PlaceHoldInput, now: Date): { startMinute: number; endMinute: number } {
  const failures: Record<string, string> = {};
  if (!isValidDate(input.date)) failures['date'] = 'Give a date as YYYY-MM-DD.';
  const startMinute = parseLocalTime(input.startLocal);
  const endMinute = parseLocalTime(input.endLocal);
  if (startMinute === null || startMinute % 15 !== 0 || startMinute === 1440) {
    failures['start_local'] = 'Start must be a quarter-hour time of day.';
  }
  if (endMinute === null || endMinute % 15 !== 0) {
    failures['end_local'] = 'End must be a quarter-hour time of day.';
  }
  if (!Number.isInteger(input.weeks) || input.weeks < 1 || input.weeks > MAX_WEEKS) {
    failures['weeks'] = `Repeat between 1 and ${MAX_WEEKS} weeks.`;
  }
  if (input.notes.length > 500) failures['notes'] = 'Notes are at most 500 characters.';
  if (Object.keys(failures).length > 0) throw errors.validation(failures);

  const start = startMinute!;
  const end = endMinute!;
  if (end <= start) {
    throw errors.validation({ end_local: 'End must be after start.' });
  }
  const length = end - start;
  if (length < MIN_HOLD_MINUTES || length > MAX_HOLD_MINUTES) {
    throw errors.validation({
      end_local: `A booking runs from ${MIN_HOLD_MINUTES} to ${MAX_HOLD_MINUTES} minutes.`,
    });
  }

  const today = kitchenToday(now);
  const offset = daysBetween(today, input.date);
  if (offset > BOOKING_WINDOW_DAYS) {
    throw errors.validation({ date: `Book at most ${BOOKING_WINDOW_DAYS} days ahead.` });
  }
  const earliest = resolveLocalOrTransition(today, currentStepMinute(now));
  const firstStart = resolveLocal(input.date, start);
  if (firstStart.instant !== null && firstStart.instant.getTime() < earliest.getTime()) {
    throw errors.validation({ start_local: 'Start cannot be earlier than the current time step.' });
  }

  for (let week = 0; week < input.weeks; week += 1) {
    const occurrenceDate = addDays(input.date, week * 7);
    if (resolveLocal(occurrenceDate, start).instant === null) {
      throw errors.validation({
        start_local: `${input.startLocal} does not exist on ${occurrenceDate} because of the clock change.`,
      });
    }
    if (resolveLocal(occurrenceDate, end).instant === null) {
      throw errors.validation({
        end_local: `${input.endLocal} does not exist on ${occurrenceDate} because of the clock change.`,
      });
    }
  }
  return { startMinute: start, endMinute: end };
}

export async function placeHold(
  actor: SessionUser,
  input: PlaceHoldInput,
): Promise<HoldWithBookings> {
  const station = await findStation(input.stationId);
  if (!station) throw errors.notFound();
  const tenant = await requireTenant(input.tenantId);

  const now = new Date();
  const { startMinute, endMinute } = validatePlacement(input, now);

  if ((await tenantStatusOf(tenant)) !== 'active') {
    throw errors.conflict('tenant_not_active', 'This business cannot book right now.');
  }

  const spans = occurrenceSpans(input.date, startMinute, endMinute, input.weeks);
  const documents = await listDocuments(tenant.id);
  const blocked = occurrencesBlockedByExpiry(documents, spans);
  if (blocked) {
    throw errors.conflict(
      'document_expires_before_booking',
      'A required document expires before this booking.',
      { kinds: blocked.kinds, dates: blocked.dates },
    );
  }

  return withTransaction(async (tx) => {
    await lockStation(tx, station.id);
    const bufferMs = CLEANING_BUFFER_MINUTES * 60_000;
    const earliest = new Date(Math.min(...spans.map((span) => span.startAt.getTime())) - bufferMs);
    const latest = new Date(Math.max(...spans.map((span) => span.endAt.getTime())) + bufferMs);
    const occupied = await occupiedSpans(tx, station.id, now, earliest, latest);
    const conflicts = conflictingDates(spans, tenant.id, occupied);
    if (conflicts.length > 0) {
      throw errors.conflict('slot_taken', 'That station is not free for the whole time.', {
        dates: conflicts,
      });
    }

    const ref = await nextHoldRef(tx);
    const hold: HoldRecord = {
      ref,
      tenantId: tenant.id,
      stationId: station.id,
      weeks: input.weeks,
      notes: input.notes,
      createdAt: now,
      expiresAt: new Date(now.getTime() + config.holdTtlSeconds * 1000),
      confirmedAt: null,
      releasedAt: null,
    };
    await insertHold(tx, hold);

    const bookings: BookingRecord[] = [];
    for (const [index, span] of spans.entries()) {
      const booking: BookingRecord = {
        id: randomUUID(),
        ref: `${ref}-${index + 1}`,
        holdRef: ref,
        tenantId: tenant.id,
        stationId: station.id,
        date: span.date,
        startLocal: input.startLocal,
        endLocal: input.endLocal,
        startAt: span.startAt,
        endAt: span.endAt,
        startMinute,
        endMinute,
        elapsedMinutes: Math.round((span.endAt.getTime() - span.startAt.getTime()) / 60_000),
        status: 'held',
        payWith: null,
        amountCents: null,
        policyVersion: null,
        notes: input.notes,
        checkedInAt: null,
        checkedOutAt: null,
        holdoverReportedMinutes: null,
        holdoverBilledMinutes: null,
        holdoverAmountCents: null,
        cancelledAt: null,
        cancellationLate: null,
        cancellationFeeCents: null,
        cancellationFeeMinutes: null,
        cancellationFeeRefunded: false,
        stationTimeInvoiceId: null,
        holdoverInvoiceId: null,
        lateFeeInvoiceId: null,
        createdAt: now,
      };
      await insertBooking(tx, booking);
      bookings.push(booking);
    }
    await recordStateChange(tx, {
      actorUserId: actor.id,
      entity: 'hold',
      entityId: ref,
      fromState: null,
      toState: 'held',
      detail: { station_id: station.id, weeks: input.weeks },
    });
    return { hold, bookings };
  });
}

export async function liveHold(
  ref: string,
  scopeTenantId: string | null,
): Promise<HoldWithBookings> {
  const hold = await findHold(ref);
  if (!hold) throw errors.notFound();
  if (scopeTenantId !== null && hold.tenantId !== scopeTenantId) throw errors.notFound();
  const live =
    hold.releasedAt === null && hold.confirmedAt === null && hold.expiresAt.getTime() > Date.now();
  if (!live) throw errors.notFound();
  return { hold, bookings: await bookingsForHold(ref) };
}

export async function releaseHold(ref: string, scopeTenantId: string | null, actorUserId: string): Promise<void> {
  const { hold } = await liveHold(ref, scopeTenantId);
  await deleteHold(hold.ref);
  await recordStateChange(pool, {
    actorUserId,
    entity: 'hold',
    entityId: hold.ref,
    fromState: 'held',
    toState: 'released',
  });
}

export interface ConfirmResult {
  ref: string;
  bookings: BookingRecord[];
}

export async function requireHold(ref: string, actor: SessionUser): Promise<HoldRecord> {
  const hold = await findHold(ref);
  if (!hold) throw errors.notFound();
  if (actor.tenantId !== null && hold.tenantId !== actor.tenantId) throw errors.notFound();
  if (hold.releasedAt !== null) throw errors.notFound();
  return hold;
}

export async function confirmHold(
  actor: SessionUser,
  existing: HoldRecord,
  payWith: 'account' | 'hour_pack',
): Promise<ConfirmResult> {
  const ref = existing.ref;
  if (existing.confirmedAt !== null) {
    throw errors.conflict('invalid_transition', 'This hold is already confirmed.');
  }

  const now = new Date();
  if (now.getTime() >= existing.expiresAt.getTime()) {
    throw errors.gone('hold_expired', 'This hold expired.');
  }

  const tenant = await requireTenant(existing.tenantId);
  if ((await tenantStatusOf(tenant)) !== 'active') {
    throw errors.conflict('tenant_not_active', 'This business cannot book right now.');
  }

  const bookings = await bookingsForHold(ref);
  const documents = await listDocuments(tenant.id);
  const blocked = occurrencesBlockedByExpiry(documents, bookings);
  if (blocked) {
    throw errors.conflict(
      'document_expires_before_booking',
      'A required document expires before this booking.',
      { kinds: blocked.kinds, dates: blocked.dates },
    );
  }

  const stations = await listStations();
  const stationsById = new Map(stations.map((station) => [station.id, station]));
  const station = stationsById.get(existing.stationId)!;
  const policy = await currentPolicy();
  const neededMinutes = bookings.reduce((total, booking) => total + booking.elapsedMinutes, 0);
  const accountId = payWith === 'account' ? await billingAccountFor(tenant) : null;

  return inUnitOfWork(async (uow) => {
    const hold = await lockHold(uow.tx, ref);
    if (!hold || hold.releasedAt !== null) throw errors.notFound();
    if (hold.confirmedAt !== null) {
      throw errors.conflict('invalid_transition', 'This hold is already confirmed.');
    }

    const amounts = new Map<string, number | null>();
    if (payWith === 'hour_pack') {
      await lockTenantHours(uow.tx, tenant.id);
      const balance = await balanceMinutes(tenant.id, uow.tx);
      if (balance < neededMinutes) {
        throw errors.conflict('insufficient_hours', 'This hour pack does not hold enough minutes.', {
          needed_minutes: neededMinutes,
          balance_minutes: balance,
        });
      }
      for (const booking of bookings) {
        amounts.set(booking.id, null);
        await recordMovement(uow.tx, tenant.id, -booking.elapsedMinutes, 'booking', booking.id);
      }
    } else {
      for (const booking of bookings) {
        amounts.set(booking.id, stationTimeCents(booking.elapsedMinutes, station.hourlyRateCents));
      }
    }

    await confirmHoldBookings(uow.tx, ref, payWith, policy.version, amounts);
    await markHoldConfirmed(uow.tx, ref, now);
    await recordStateChange(uow.tx, {
      actorUserId: actor.id,
      entity: 'hold',
      entityId: ref,
      fromState: 'held',
      toState: 'confirmed',
      detail: { pay_with: payWith, policy_version: policy.version },
    });

    const confirmed = bookings.map((booking) => ({
      ...booking,
      status: 'confirmed' as const,
      payWith,
      amountCents: amounts.get(booking.id) ?? null,
      policyVersion: policy.version,
    }));

    if (payWith === 'account' && accountId) {
      for (const booking of confirmed) {
        await uow.charge(
          tenant.id,
          accountId,
          booking.amountCents ?? 0,
          `Station time ${booking.ref}`,
        );
      }
    }
    await uow.sendNow(bookingConfirmationEmail(tenant, ref, confirmed, stationsById, policy));
    return { ref, bookings: confirmed };
  });
}
