import { errors } from '../http/errors.js';
import type { SessionUser } from '../http/context.js';
import { withTransaction } from '../db/pool.js';
import {
  findBooking,
  lockBooking,
  searchBookings,
  updateBooking,
  type BookingFilters,
} from '../db/repo/bookings.js';
import { findStation, listStations } from '../db/repo/catalog.js';
import { recordMovement } from '../db/repo/ledger.js';
import { findPolicy } from '../db/repo/policy.js';
import { recordStateChange } from '../db/repo/audit.js';
import { listTenants } from '../db/repo/tenants.js';
import { cancellationOutcome } from '../domain/cancellation.js';
import {
  BOOKING_WINDOW_DAYS,
  CHECK_IN_LEAD_MINUTES,
  DIAL_PAST_DAYS,
  MAX_HOLDOVER_MINUTES,
  MAX_SEARCH_ROWS,
  type BookingStatus,
} from '../domain/constants.js';
import { holdoverFor } from '../domain/holdover.js';
import { formatDollars } from '../domain/money.js';
import { addDays, isValidDate, kitchenToday } from '../domain/time.js';
import type { BookingRecord } from '../domain/types.js';
import { holdoverNoticeEmail } from './emails.js';
import { billingAccountFor, requireTenant, tenantStatusOf } from './tenants.js';
import { inUnitOfWork } from './unitOfWork.js';

const SEARCHABLE_STATUSES: readonly BookingStatus[] = [
  'confirmed',
  'checked_in',
  'completed',
  'cancelled',
  'no_show',
];

export interface SearchParams {
  q: string | null;
  from: string | null;
  to: string | null;
  status: string | null;
  stationId: string | null;
}

export async function resolveFilters(
  actor: SessionUser,
  params: SearchParams,
  limit: number | null,
): Promise<BookingFilters> {
  const today = kitchenToday();
  const from = params.from ?? addDays(today, -DIAL_PAST_DAYS);
  const to = params.to ?? addDays(today, BOOKING_WINDOW_DAYS);
  const failures: Record<string, string> = {};
  if (!isValidDate(from)) failures['from'] = 'Give a date as YYYY-MM-DD.';
  if (!isValidDate(to)) failures['to'] = 'Give a date as YYYY-MM-DD.';
  if (params.status !== null && !SEARCHABLE_STATUSES.includes(params.status as BookingStatus)) {
    failures['status'] = 'Choose a booking status.';
  }
  if (params.stationId !== null && (await findStation(params.stationId)) === null) {
    failures['station_id'] = 'Choose a station.';
  }
  if (Object.keys(failures).length > 0) throw errors.validation(failures);
  return {
    tenantId: actor.role === 'operator' ? null : actor.tenantId,
    q: params.q && params.q.length > 0 ? params.q : null,
    from,
    to,
    status: (params.status as BookingStatus | null) ?? null,
    stationId: params.stationId,
    limit,
  };
}

export async function listBookings(filters: BookingFilters): Promise<BookingRecord[]> {
  return searchBookings(filters);
}

export async function searchForActor(actor: SessionUser, params: SearchParams): Promise<BookingRecord[]> {
  return listBookings(await resolveFilters(actor, params, MAX_SEARCH_ROWS));
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export async function exportCsv(
  actor: SessionUser,
  params: SearchParams,
): Promise<{ csv: string; from: string; to: string }> {
  const filters = await resolveFilters(actor, params, null);
  const bookings = await listBookings(filters);
  const stations = new Map((await listStations()).map((station) => [station.id, station.name]));
  const tenants = new Map((await listTenants()).map((tenant) => [tenant.id, tenant]));
  const operator = actor.role === 'operator';
  const header = operator
    ? ['tenant', 'ref', 'station', 'date', 'start', 'end', 'status', 'payment', 'amount', 'notes', 'contact_email']
    : ['ref', 'station', 'date', 'start', 'end', 'status', 'payment', 'amount', 'notes'];
  const rows = bookings.map((booking) => {
    const tenant = tenants.get(booking.tenantId);
    const amount =
      booking.payWith === 'account' && booking.amountCents !== null
        ? formatDollars(booking.amountCents)
        : '';
    const core = [
      booking.ref,
      stations.get(booking.stationId) ?? booking.stationId,
      booking.date,
      booking.startLocal,
      booking.endLocal,
      booking.status,
      booking.payWith ?? '',
      amount,
      booking.notes,
    ];
    return operator
      ? [tenant ? tenant.businessName : booking.tenantId, ...core, tenant ? tenant.ownerEmail : '']
      : core;
  });
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
  return { csv: `${csv}\n`, from: filters.from, to: filters.to };
}

export async function requireBooking(id: string, actor: SessionUser): Promise<BookingRecord> {
  const booking = await findBooking(id);
  if (!booking) throw errors.notFound();
  if (actor.tenantId !== null && booking.tenantId !== actor.tenantId) throw errors.notFound();
  if (booking.status === 'held') throw errors.notFound();
  return booking;
}

export async function checkIn(actor: SessionUser, booking: BookingRecord): Promise<BookingRecord> {
  if (booking.status !== 'confirmed') {
    throw errors.conflict('invalid_transition', 'This booking cannot be checked in.');
  }
  const now = Date.now();
  const opensAt = booking.startAt.getTime() - CHECK_IN_LEAD_MINUTES * 60_000;
  if (now < opensAt || now >= booking.endAt.getTime()) {
    throw errors.conflict('outside_check_in_window', 'Check-in is not open for this booking.');
  }
  const tenant = await requireTenant(booking.tenantId);
  if ((await tenantStatusOf(tenant)) !== 'active') {
    throw errors.conflict('tenant_not_active', 'A required document has expired.');
  }
  const at = new Date(now);
  await withTransaction(async (tx) => {
    await updateBooking(tx, booking.id, { status: 'checked_in', checked_in_at: at });
    await recordStateChange(tx, {
      actorUserId: actor.id,
      entity: 'booking',
      entityId: booking.id,
      fromState: 'confirmed',
      toState: 'checked_in',
    });
  });
  return (await findBooking(booking.id))!;
}

export async function checkOut(
  actor: SessionUser,
  booking: BookingRecord,
  holdoverMinutes: number,
): Promise<BookingRecord> {
  if (booking.status !== 'checked_in') {
    throw errors.conflict('invalid_transition', 'This booking cannot be checked out.');
  }
  if (
    !Number.isInteger(holdoverMinutes) ||
    holdoverMinutes < 0 ||
    holdoverMinutes > MAX_HOLDOVER_MINUTES
  ) {
    throw errors.validation({
      holdover_minutes: `Enter whole minutes from 0 to ${MAX_HOLDOVER_MINUTES}.`,
    });
  }

  const station = (await findStation(booking.stationId))!;
  const outcome = holdoverFor(holdoverMinutes, station.hourlyRateCents);
  const tenant = await requireTenant(booking.tenantId);
  const at = new Date();

  if (outcome.billedMinutes === 0) {
    await withTransaction(async (tx) => {
      await applyCheckOut(tx, booking, outcome, at, actor.id);
    });
    return (await findBooking(booking.id))!;
  }

  const accountId = await billingAccountFor(tenant);
  await inUnitOfWork(async (uow) => {
    const locked = await lockBooking(uow.tx, booking.id);
    if (!locked || locked.status !== 'checked_in') {
      throw errors.conflict('invalid_transition', 'This booking cannot be checked out.');
    }
    await applyCheckOut(uow.tx, booking, outcome, at, actor.id);
    await uow.charge(tenant.id, accountId, outcome.amountCents, `Hold-over ${booking.ref}`);
    await uow.sendNow(
      holdoverNoticeEmail(
        tenant,
        booking,
        station,
        outcome.reportedMinutes,
        outcome.billedMinutes,
        outcome.amountCents,
      ),
    );
  });
  return (await findBooking(booking.id))!;
}

async function applyCheckOut(
  tx: Parameters<typeof updateBooking>[0],
  booking: BookingRecord,
  outcome: { reportedMinutes: number; billedMinutes: number; amountCents: number },
  at: Date,
  actorUserId: string,
): Promise<void> {
  await updateBooking(tx, booking.id, {
    status: 'completed',
    checked_out_at: at,
    holdover_reported_minutes: outcome.reportedMinutes,
    holdover_billed_minutes: outcome.billedMinutes,
    holdover_amount_cents: outcome.amountCents,
  });
  await recordStateChange(tx, {
    actorUserId,
    entity: 'booking',
    entityId: booking.id,
    fromState: 'checked_in',
    toState: 'completed',
    detail: { holdover_billed_minutes: outcome.billedMinutes },
  });
}

export async function cancelBooking(actor: SessionUser, booking: BookingRecord): Promise<BookingRecord> {
  if (booking.status !== 'confirmed') {
    throw errors.conflict('invalid_transition', 'This booking cannot be cancelled.');
  }
  const at = new Date();
  if (at.getTime() >= booking.startAt.getTime()) {
    throw errors.conflict('already_started', 'This booking has started.');
  }
  const policy = await findPolicy(booking.policyVersion!);
  const outcome = cancellationOutcome(booking, policy, at);
  const tenant = await requireTenant(booking.tenantId);

  if (booking.payWith === 'hour_pack') {
    await withTransaction(async (tx) => {
      if (outcome.returnedMinutes > 0) {
        await recordMovement(tx, tenant.id, outcome.returnedMinutes, 'cancellation_return', booking.id);
      }
      await applyCancellation(tx, booking, outcome, at, actor.id);
    });
    return (await findBooking(booking.id))!;
  }

  const accountId = await billingAccountFor(tenant);
  await inUnitOfWork(async (uow) => {
    const locked = await lockBooking(uow.tx, booking.id);
    if (!locked || locked.status !== 'confirmed') {
      throw errors.conflict('invalid_transition', 'This booking cannot be cancelled.');
    }
    await applyCancellation(uow.tx, booking, outcome, at, actor.id);
    await uow.credit(tenant.id, accountId, outcome.creditCents, `Cancellation credit ${booking.ref}`);
    if (outcome.feeCents > 0) {
      await uow.charge(tenant.id, accountId, outcome.feeCents, `Late cancellation fee ${booking.ref}`);
    }
  });
  return (await findBooking(booking.id))!;
}

async function applyCancellation(
  tx: Parameters<typeof updateBooking>[0],
  booking: BookingRecord,
  outcome: { late: boolean; feeCents: number; feeMinutes: number },
  at: Date,
  actorUserId: string,
): Promise<void> {
  await updateBooking(tx, booking.id, {
    status: 'cancelled',
    cancelled_at: at,
    cancellation_late: outcome.late,
    cancellation_fee_cents: outcome.feeCents,
    cancellation_fee_minutes: outcome.feeMinutes,
  });
  await recordStateChange(tx, {
    actorUserId,
    entity: 'booking',
    entityId: booking.id,
    fromState: 'confirmed',
    toState: 'cancelled',
    detail: { late: outcome.late },
  });
}

export async function markNoShow(actor: SessionUser, booking: BookingRecord): Promise<BookingRecord> {
  if (booking.status !== 'confirmed') {
    throw errors.conflict('invalid_transition', 'This booking cannot be marked as a no-show.');
  }
  if (Date.now() < booking.startAt.getTime()) {
    throw errors.conflict('not_started', 'This booking has not started yet.');
  }
  await withTransaction(async (tx) => {
    await updateBooking(tx, booking.id, { status: 'no_show' });
    await recordStateChange(tx, {
      actorUserId: actor.id,
      entity: 'booking',
      entityId: booking.id,
      fromState: 'confirmed',
      toState: 'no_show',
    });
  });
  return (await findBooking(booking.id))!;
}

export async function refundFee(actor: SessionUser, booking: BookingRecord): Promise<BookingRecord> {
  const feeCents = booking.cancellationFeeCents ?? 0;
  const feeMinutes = booking.cancellationFeeMinutes ?? 0;
  const hasFee = feeCents > 0 || feeMinutes > 0;
  if (booking.status !== 'cancelled' || !hasFee || booking.cancellationFeeRefunded) {
    throw errors.conflict('invalid_transition', 'That fee cannot be refunded.');
  }
  if (booking.lateFeeInvoiceId !== null) {
    throw errors.conflict('fee_invoiced', 'That fee is already on an invoice.');
  }
  const tenant = await requireTenant(booking.tenantId);

  if (booking.payWith === 'hour_pack') {
    await withTransaction(async (tx) => {
      await recordMovement(tx, tenant.id, feeMinutes, 'fee_refund', booking.id);
      await updateBooking(tx, booking.id, { cancellation_fee_refunded: true });
      await recordStateChange(tx, {
        actorUserId: actor.id,
        entity: 'booking',
        entityId: booking.id,
        fromState: 'cancelled',
        toState: 'fee_refunded',
      });
    });
    return (await findBooking(booking.id))!;
  }

  const accountId = await billingAccountFor(tenant);
  await inUnitOfWork(async (uow) => {
    const locked = await lockBooking(uow.tx, booking.id);
    if (!locked || locked.cancellationFeeRefunded) {
      throw errors.conflict('invalid_transition', 'That fee cannot be refunded.');
    }
    await updateBooking(uow.tx, booking.id, { cancellation_fee_refunded: true });
    await recordStateChange(uow.tx, {
      actorUserId: actor.id,
      entity: 'booking',
      entityId: booking.id,
      fromState: 'cancelled',
      toState: 'fee_refunded',
    });
    await uow.credit(tenant.id, accountId, feeCents, `Fee refund ${booking.ref}`);
  });
  return (await findBooking(booking.id))!;
}
