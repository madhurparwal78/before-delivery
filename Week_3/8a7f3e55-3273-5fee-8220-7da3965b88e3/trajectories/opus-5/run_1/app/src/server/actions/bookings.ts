import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Quote, SessionUser } from '../../shared/api.js';
import { withTransaction } from '../db/pool.js';
import { BOOKING_REF_PREFIX, LINE_REF_PREFIX } from '../db/seed-data.js';
import {
  isPreCheckIn,
  openCallCloseInstant,
  seatCountForNewBooking,
} from '../domain/booking-rules.js';
import { cancellationQuote } from '../domain/cancellation.js';
import { computeLineAmounts, rateInForce } from '../domain/billing.js';
import { isQualified } from '../domain/qualification.js';
import { agencyDate, dateOnlyAddDays, mondayOfDate } from '../domain/time.js';
import { apiError, invalidTransition, quoteChanged, FIELD_MESSAGES } from '../http/errors.js';
import { FieldErrors, integerFrom, type BookingDraft } from '../http/validation.js';
import {
  holders,
  loadBooking,
  seatsHeld,
  seatOf,
  type BookingRecord,
} from '../store/bookings.js';
import { contractForOrg } from '../store/contracts.js';
import { findInterpreter } from '../store/people.js';
import {
  applySeatStatus,
  isBusy,
  lockBooking,
  nextReference,
  queueEmail,
  writeAudit,
} from './common.js';
import {
  assignmentBody,
  assignmentSubject,
  cancellationSubject,
  coverageBody,
  coverageSubject,
  interpreterCancellationBody,
  requesterCancellationBody,
} from './emails.js';
import { openCallStatusOf } from '../views/booking.js';

async function reload(client: PoolClient, id: string): Promise<BookingRecord> {
  const booking = await loadBooking(id, client);
  if (!booking) throw new Error(`Booking ${id} disappeared`);
  return booking;
}

async function requesterForOrg(client: PoolClient, orgId: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    "SELECT id FROM users WHERE role = 'requester' AND org_id = $1 ORDER BY id LIMIT 1",
    [orgId],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`No requester seeded for organisation ${orgId}`);
  return row.id;
}

export async function createBooking(
  actor: SessionUser,
  draft: BookingDraft,
): Promise<BookingRecord> {
  return withTransaction(async (client) => {
    const requesterId =
      actor.role === 'requester' ? actor.id : await requesterForOrg(client, draft.orgId);
    const seatCount = seatCountForNewBooking(draft.setting, draft.durationMinutes);
    const ref = await nextReference(client, 'booking_ref', BOOKING_REF_PREFIX);
    const id = randomUUID();
    await client.query(
      `INSERT INTO bookings (id, ref, org_id, requester_id, setting, title, location,
         onsite_contact_name, onsite_contact_phone, consumer_name, start_at, duration_minutes,
         assignment_date, status, seat_count, requester_notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'submitted', $14, $15)`,
      [
        id,
        ref,
        draft.orgId,
        requesterId,
        draft.setting,
        draft.title,
        draft.location,
        draft.onsiteContactName,
        draft.onsiteContactPhone,
        draft.consumerName,
        draft.start,
        draft.durationMinutes,
        agencyDate(draft.start),
        seatCount,
        draft.requesterNotes,
      ],
    );
    for (let seat = 1; seat <= seatCount; seat += 1) {
      await client.query('INSERT INTO seats (booking_id, seat) VALUES ($1, $2)', [id, seat]);
    }
    await writeAudit(client, {
      bookingId: id,
      actorName: actor.name,
      action: 'submitted',
      fromStatus: null,
      toStatus: 'submitted',
    });
    return reload(client, id);
  });
}

export async function makeTeamBooking(
  actor: SessionUser,
  bookingId: string,
): Promise<BookingRecord> {
  return withTransaction(async (client) => {
    const booking = await lockBooking(client, bookingId);
    if (!booking) throw apiError('not_found');
    if (booking.seat_count === 2) throw apiError('already_team');
    if (!isPreCheckIn(booking.status)) throw invalidTransition(booking.status);
    await client.query('UPDATE bookings SET seat_count = 2 WHERE id = $1', [bookingId]);
    await client.query(
      'INSERT INTO seats (booking_id, seat) VALUES ($1, 2) ON CONFLICT DO NOTHING',
      [bookingId],
    );
    const status = await applySeatStatus(client, booking);
    await writeAudit(client, {
      bookingId,
      actorName: actor.name,
      action: 'made_team',
      fromStatus: booking.status,
      toStatus: status,
    });
    return reload(client, bookingId);
  });
}

export async function postOpenCall(
  actor: SessionUser,
  bookingId: string,
  now: Date,
): Promise<BookingRecord> {
  return withTransaction(async (client) => {
    const booking = await lockBooking(client, bookingId);
    if (!booking) throw apiError('not_found');
    if (booking.status !== 'submitted') throw invalidTransition(booking.status);
    const closesAt = openCallCloseInstant(booking.start_at);
    if (now.getTime() >= closesAt.getTime()) throw apiError('open_call_closed');
    await client.query(
      "UPDATE bookings SET open_call_closes_at = $2, status = 'open' WHERE id = $1",
      [bookingId, closesAt],
    );
    await writeAudit(client, {
      bookingId,
      actorName: actor.name,
      action: 'open_call_published',
      fromStatus: booking.status,
      toStatus: 'open',
    });
    return reload(client, bookingId);
  });
}

async function fillSeat(
  client: PoolClient,
  booking: BookingRecord,
  seat: number,
  interpreterId: string,
  actorName: string,
): Promise<BookingRecord> {
  await client.query(
    'UPDATE seats SET holder_id = $3, held_at = now() WHERE booking_id = $1 AND seat = $2',
    [booking.id, seat, interpreterId],
  );
  const status = await applySeatStatus(client, booking);
  const fresh = await reload(client, booking.id);
  const holder = fresh.seats.find((entry) => entry.seat === seat)?.holder;
  if (!holder) throw new Error('Seat fill did not take effect');
  await writeAudit(client, {
    bookingId: booking.id,
    actorName,
    action: 'seat_filled',
    fromStatus: booking.status,
    toStatus: status,
    seat,
    interpreterName: holder.name,
  });
  const coInterpreter =
    fresh.seats.find((entry) => entry.seat !== seat && entry.holder !== null)?.holder ?? null;
  await queueEmail(
    client,
    holder.email,
    assignmentSubject(fresh),
    assignmentBody(fresh, seat, coInterpreter?.name ?? null, fresh.materials.length),
  );
  if (status === 'covered') {
    await queueEmail(
      client,
      fresh.requester_email,
      coverageSubject(fresh),
      coverageBody(fresh, holders(fresh)),
    );
  }
  return fresh;
}

export async function claimSeat(
  actor: SessionUser,
  bookingId: string,
  now: Date,
): Promise<BookingRecord> {
  return withTransaction(async (client) => {
    const booking = await lockBooking(client, bookingId);
    if (!booking) throw apiError('not_found');
    if (!isPreCheckIn(booking.status)) throw invalidTransition(booking.status);
    if (seatOf(booking, actor.id) !== null) throw apiError('already_holding');
    const vacant = booking.seats.find((seat) => seat.holder === null);
    if (!vacant) throw apiError('seat_filled');
    if (openCallStatusOf(booking, now) !== 'open') throw apiError('open_call_closed');
    if (await isBusy(client, actor.id, booking)) throw apiError('schedule_conflict');
    return fillSeat(client, booking, vacant.seat, actor.id, actor.name);
  });
}

export async function assignSeat(
  actor: SessionUser,
  bookingId: string,
  body: Record<string, unknown>,
): Promise<BookingRecord> {
  const rawInterpreterId = body['interpreter_id'];
  const interpreter =
    typeof rawInterpreterId === 'string' && rawInterpreterId.length > 0
      ? await findInterpreter(rawInterpreterId)
      : null;
  if (typeof rawInterpreterId === 'string' && rawInterpreterId.length > 0 && !interpreter) {
    throw apiError('not_found');
  }

  return withTransaction(async (client) => {
    const booking = await lockBooking(client, bookingId);
    if (!booking) throw apiError('not_found');

    const errors = new FieldErrors();
    if (!interpreter) errors.add('interpreter_id', FIELD_MESSAGES.interpreter_id);
    const seat = integerFrom(body['seat']);
    if (seat === null || seat < 1 || seat > booking.seat_count) {
      errors.add('seat', FIELD_MESSAGES.seat);
    }
    errors.throwIfAny();
    if (!interpreter || seat === null) throw new Error('Unreachable assignment validation');

    if (!isPreCheckIn(booking.status)) throw invalidTransition(booking.status);
    if (seatOf(booking, interpreter.id) !== null) throw apiError('already_holding');
    const target = booking.seats.find((entry) => entry.seat === seat);
    if (!target) throw apiError('not_found');
    if (target.holder !== null) throw apiError('seat_filled');
    if (!isQualified(interpreter.credentials, booking.setting, booking.assignment_date)) {
      throw apiError('not_qualified');
    }
    if (await isBusy(client, interpreter.id, booking)) throw apiError('schedule_conflict');
    return fillSeat(client, booking, seat, interpreter.id, actor.name);
  });
}

export async function releaseSeat(
  actor: SessionUser,
  bookingId: string,
  seat: number,
): Promise<BookingRecord> {
  return withTransaction(async (client) => {
    const booking = await lockBooking(client, bookingId);
    if (!booking) throw apiError('not_found');
    const target = booking.seats.find((entry) => entry.seat === seat);
    if (!target) throw apiError('not_found');
    if (actor.role === 'interpreter' && target.holder?.id !== actor.id) throw apiError('forbidden');
    if (booking.status !== 'partially_covered' && booking.status !== 'covered') {
      throw invalidTransition(booking.status);
    }
    const holder = target.holder;
    if (!holder) throw invalidTransition(booking.status);
    await client.query(
      'UPDATE seats SET holder_id = NULL, held_at = NULL WHERE booking_id = $1 AND seat = $2',
      [bookingId, seat],
    );
    const status = await applySeatStatus(client, booking);
    await writeAudit(client, {
      bookingId,
      actorName: actor.name,
      action: 'seat_released',
      fromStatus: booking.status,
      toStatus: status,
      seat,
      interpreterName: holder.name,
    });
    return reload(client, bookingId);
  });
}

export async function checkInBooking(
  actor: SessionUser,
  bookingId: string,
): Promise<BookingRecord> {
  return withTransaction(async (client) => {
    const booking = await lockBooking(client, bookingId);
    if (!booking) throw apiError('not_found');
    if (booking.status !== 'covered') throw invalidTransition(booking.status);
    await client.query("UPDATE bookings SET status = 'in_progress' WHERE id = $1", [bookingId]);
    await writeAudit(client, {
      bookingId,
      actorName: actor.name,
      action: 'checked_in',
      fromStatus: booking.status,
      toStatus: 'in_progress',
    });
    return reload(client, bookingId);
  });
}

async function resolveBillingWeek(
  client: PoolClient,
  orgId: string,
  createdAt: Date,
): Promise<string> {
  let week = mondayOfDate(agencyDate(createdAt));
  for (;;) {
    const closed = await client.query(
      'SELECT 1 FROM billing_weeks WHERE org_id = $1 AND week_start = $2',
      [orgId, week],
    );
    if (closed.rowCount === 0) return week;
    week = dateOnlyAddDays(week, 7);
  }
}

async function createInvoiceLine(
  client: PoolClient,
  booking: BookingRecord,
  kind: 'completed' | 'late_cancellation',
  basisMinutes: number,
  mileageMiles: number,
  interpreterCount: number,
  now: Date,
): Promise<string> {
  const contract = await contractForOrg(booking.org_id, client);
  const rate = rateInForce(contract.rates, booking.assignment_date);
  const amounts = computeLineAmounts({
    rate,
    terms: contract,
    basisMinutes,
    interpreterCount,
    mileageMiles,
  });
  const lineRef = await nextReference(client, 'line_ref', LINE_REF_PREFIX);
  const billingWeek = await resolveBillingWeek(client, booking.org_id, now);
  await client.query(
    `INSERT INTO invoice_lines (line_ref, booking_id, org_id, kind, assignment_date,
       rate_effective_from, hourly_rate_cents, team_surcharge_bp, basis_minutes, billable_minutes,
       interpreter_count, time_amount_cents, mileage_miles, mileage_cents_per_mile,
       mileage_amount_cents, amount_cents, billing_week, sync_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'pending_sync')`,
    [
      lineRef,
      booking.id,
      booking.org_id,
      kind,
      booking.assignment_date,
      rate.effective_from,
      rate.hourly_rate_cents,
      rate.team_surcharge_bp,
      basisMinutes,
      amounts.billable_minutes,
      interpreterCount,
      amounts.time_amount_cents,
      mileageMiles,
      rate.mileage_cents_per_mile,
      amounts.mileage_amount_cents,
      amounts.amount_cents,
      billingWeek,
    ],
  );
  return lineRef;
}

export async function completeBooking(
  actor: SessionUser,
  bookingId: string,
  body: Record<string, unknown>,
  now: Date,
): Promise<BookingRecord> {
  const errors = new FieldErrors();
  const workedMinutes = integerFrom(body['worked_minutes']);
  if (workedMinutes === null || workedMinutes < 1 || workedMinutes > 720) {
    errors.add('worked_minutes', FIELD_MESSAGES.worked_minutes);
  }
  const mileageMiles = integerFrom(body['mileage_miles']);
  if (mileageMiles === null || mileageMiles < 0 || mileageMiles > 500) {
    errors.add('mileage_miles', FIELD_MESSAGES.mileage_miles);
  }
  errors.throwIfAny();
  if (workedMinutes === null || mileageMiles === null) {
    throw new Error('Unreachable completion validation');
  }

  return withTransaction(async (client) => {
    const booking = await lockBooking(client, bookingId);
    if (!booking) throw apiError('not_found');
    if (booking.status !== 'in_progress') throw invalidTransition(booking.status);
    const basis = Math.max(booking.duration_minutes, workedMinutes);
    await createInvoiceLine(
      client,
      booking,
      'completed',
      basis,
      mileageMiles,
      seatsHeld(booking),
      now,
    );
    await client.query("UPDATE bookings SET status = 'completed', completed_at = $2 WHERE id = $1", [
      bookingId,
      now,
    ]);
    await writeAudit(client, {
      bookingId,
      actorName: actor.name,
      action: 'completed',
      fromStatus: booking.status,
      toStatus: 'completed',
    });
    return reload(client, bookingId);
  });
}

export async function quoteFor(booking: BookingRecord, now: Date): Promise<Quote> {
  const contract = await contractForOrg(booking.org_id);
  return cancellationQuote({
    start: booking.start_at,
    durationMinutes: booking.duration_minutes,
    seatsHeld: seatsHeld(booking),
    rate: rateInForce(contract.rates, booking.assignment_date),
    terms: contract,
    now,
  });
}

export async function cancelBooking(
  actor: SessionUser,
  bookingId: string,
  body: Record<string, unknown>,
  now: Date,
): Promise<BookingRecord> {
  const errors = new FieldErrors();
  const quoted = integerFrom(body['quoted_charge_cents']);
  if (quoted === null || quoted < 0) {
    errors.add('quoted_charge_cents', FIELD_MESSAGES.quoted_charge_cents);
  }
  errors.throwIfAny();

  return withTransaction(async (client) => {
    const booking = await lockBooking(client, bookingId);
    if (!booking) throw apiError('not_found');
    if (!isPreCheckIn(booking.status)) throw invalidTransition(booking.status);
    const quote = await quoteFor(booking, now);
    if (quote.charge_cents !== quoted) throw quoteChanged(quote);

    const held = holders(booking);
    const chargeable = quote.charge_cents > 0;
    const finalStatus = quote.late && held.length > 0 ? 'cancelled_late' : 'cancelled';
    if (chargeable) {
      await createInvoiceLine(
        client,
        booking,
        'late_cancellation',
        booking.duration_minutes,
        0,
        held.length,
        now,
      );
    }
    await client.query('UPDATE bookings SET status = $2 WHERE id = $1', [bookingId, finalStatus]);
    await writeAudit(client, {
      bookingId,
      actorName: actor.name,
      action: 'cancelled',
      fromStatus: booking.status,
      toStatus: finalStatus,
    });
    await queueEmail(
      client,
      booking.requester_email,
      cancellationSubject(booking),
      requesterCancellationBody(booking, held, quote.charge_cents),
    );
    for (const holder of held) {
      const seat = seatOf(booking, holder.id);
      if (seat === null) continue;
      await queueEmail(
        client,
        holder.email,
        cancellationSubject(booking),
        interpreterCancellationBody(booking, seat, quote.late),
      );
    }
    return reload(client, bookingId);
  });
}
