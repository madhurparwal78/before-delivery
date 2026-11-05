import { isBenchLabel, tierName, tierOfBench } from '../../shared/benches.js';
import { pool, withLedgerLock } from '../db/pool.js';
import {
  loadReservation,
  loadReservationsForGroup,
  serializeReservation,
  type ReservationDetail,
} from '../db/reservations.js';
import { offerFreedBenches, sweepIfDue, sweepLedger } from '../domain/holds.js';
import { computeLedger } from '../domain/ledger.js';
import {
  chargeThroughKillBill,
  clearPaymentInFlight,
  finishPayment,
  markPaymentInFlight,
  type SeatCharge,
} from '../domain/payments.js';
import { PRICES } from '../../shared/prices.js';
import { refundDueCents } from '../domain/refundSchedule.js';
import { canTransition, SOLD_STATES } from '../domain/reservationState.js';
import { upgradeSplit } from '../domain/upgradeSplit.js';
import { depositsOpen, serverNow, venueDate } from '../domain/venue.js';
import { BillingUnavailable } from '../services/killbill.js';
import { StorageUnavailable } from '../services/s3.js';
import type { JsonResponse, Route } from '../http/context.js';
import { conflict, notFound } from '../http/errors.js';
import { fieldError, readBillingName } from './helpers.js';
import { loadGroupRow, serializeGroup } from './serialize.js';

const IDEMPOTENCY_CONFLICT = 'This Idempotency-Key was used for a different request.';

function holdIsLive(reservation: ReservationDetail, at: Date): boolean {
  if (reservation.state !== 'held') return false;
  if (reservation.payment_in_flight !== null || reservation.payment_pending !== null) return true;
  return reservation.hold_expires_at !== null && reservation.hold_expires_at.getTime() > at.getTime();
}

async function respondWithReservation(id: string, status: number): Promise<JsonResponse> {
  const at = serverNow();
  const reservation = await loadReservation(pool, id);
  if (reservation === null) throw notFound();
  return { status, body: { reservation: serializeReservation(reservation, at) } };
}

async function runSeatPayment(input: {
  readonly reservationId: string;
  readonly kind: 'deposit' | 'balance' | 'full';
  readonly externalKey: string;
  readonly charge: SeatCharge;
  readonly billingName: string;
  readonly buyer: Parameters<typeof chargeThroughKillBill>[0]['buyer'];
}): Promise<JsonResponse> {
  try {
    const recorded = await chargeThroughKillBill({
      buyer: input.buyer,
      kind: input.kind,
      reservationId: input.reservationId,
      groupId: null,
      externalKey: input.externalKey,
      billingName: input.billingName,
      charges: [input.charge],
    });
    try {
      await finishPayment(recorded.paymentId);
    } catch (error) {
      if (error instanceof StorageUnavailable) {
        return respondWithReservation(input.reservationId, 202);
      }
      throw error;
    }
    return respondWithReservation(input.reservationId, 201);
  } catch (error) {
    if (error instanceof BillingUnavailable) {
      await clearPaymentInFlight([input.reservationId]);
      await sweepIfDue();
    }
    throw error;
  }
}

export const paymentRoutes: readonly Route[] = [
  {
    method: 'POST',
    pattern: '/api/reservations/:id/deposit',
    access: ['practitioner', 'clinic'],
    idempotent: true,
    handler: async (ctx) => {
      const account = ctx.signedIn();
      const id = ctx.param('id');
      const body = ctx.json();
      await sweepIfDue();

      const reservation = await loadReservation(pool, id);
      if (reservation === null || reservation.buyer_id !== account.id) throw notFound();
      if (ctx.idempotencyConflict()) throw conflict('idempotency_conflict', IDEMPOTENCY_CONFLICT);

      const at = serverNow();
      if (SOLD_STATES.includes(reservation.state)) {
        throw conflict('already_paid', 'This seat is already paid.');
      }
      if (!holdIsLive(reservation, at)) {
        throw conflict('hold_expired', 'The hold on this bench has ended.');
      }
      if (!depositsOpen()) {
        throw conflict('deposits_closed', 'Deposits closed on 19 March 2027.');
      }

      ctx.idempotencyKey();
      const billingName = readBillingName(body);

      const amountCents = PRICES[reservation.tier].depositCents;
      await withLedgerLock(async (client) => {
        await markPaymentInFlight(client, [id], 'deposit');
      });
      return runSeatPayment({
        reservationId: id,
        kind: 'deposit',
        externalKey: `ob-deposit-${id}`,
        charge: {
          reservationId: id,
          description: `Bench ${reservation.bench} ${tierName(reservation.tier)} deposit`,
          amountCents,
        },
        billingName,
        buyer: account,
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/reservations/:id/full',
    access: ['practitioner', 'clinic'],
    idempotent: true,
    handler: async (ctx) => {
      const account = ctx.signedIn();
      const id = ctx.param('id');
      const body = ctx.json();
      await sweepIfDue();

      const reservation = await loadReservation(pool, id);
      if (reservation === null || reservation.buyer_id !== account.id) throw notFound();
      if (ctx.idempotencyConflict()) throw conflict('idempotency_conflict', IDEMPOTENCY_CONFLICT);

      const at = serverNow();
      if (SOLD_STATES.includes(reservation.state)) {
        throw conflict('already_paid', 'This seat is already paid.');
      }
      if (!holdIsLive(reservation, at)) {
        throw conflict('hold_expired', 'The hold on this bench has ended.');
      }

      ctx.idempotencyKey();
      const billingName = readBillingName(body);

      await withLedgerLock(async (client) => {
        await markPaymentInFlight(client, [id], 'full');
      });
      return runSeatPayment({
        reservationId: id,
        kind: 'full',
        externalKey: `ob-full-${id}`,
        charge: {
          reservationId: id,
          description: `Bench ${reservation.bench} ${tierName(reservation.tier)} full price`,
          amountCents: reservation.price_cents - reservation.purchased_cents,
        },
        billingName,
        buyer: account,
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/reservations/:id/balance',
    access: ['practitioner', 'clinic'],
    idempotent: true,
    handler: async (ctx) => {
      const account = ctx.signedIn();
      const id = ctx.param('id');
      const body = ctx.json();
      await sweepIfDue();

      const reservation = await loadReservation(pool, id);
      if (reservation === null || reservation.buyer_id !== account.id) throw notFound();
      if (ctx.idempotencyConflict()) throw conflict('idempotency_conflict', IDEMPOTENCY_CONFLICT);

      if (reservation.state !== 'deposit_paid') {
        if (SOLD_STATES.includes(reservation.state)) {
          throw conflict('already_paid', 'This seat is already paid in full.');
        }
        throw conflict('not_deposit_paid', 'Pay the deposit before the balance.');
      }

      ctx.idempotencyKey();
      const billingName = readBillingName(body);

      await withLedgerLock(async (client) => {
        await markPaymentInFlight(client, [id], 'balance');
      });
      return runSeatPayment({
        reservationId: id,
        kind: 'balance',
        externalKey: `ob-balance-${id}`,
        charge: {
          reservationId: id,
          description: `Bench ${reservation.bench} ${tierName(reservation.tier)} balance`,
          amountCents: reservation.price_cents - reservation.purchased_cents,
        },
        billingName,
        buyer: account,
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/reservations/:id/upgrade',
    access: ['practitioner', 'clinic'],
    idempotent: true,
    handler: async (ctx) => {
      const account = ctx.signedIn();
      const id = ctx.param('id');
      const body = ctx.json();
      await sweepIfDue();

      const reservation = await loadReservation(pool, id);
      if (reservation === null || reservation.buyer_id !== account.id) throw notFound();
      if (ctx.idempotencyConflict()) throw conflict('idempotency_conflict', IDEMPOTENCY_CONFLICT);

      if (reservation.state !== 'deposit_paid' && reservation.state !== 'paid_in_full') {
        throw conflict('not_paid', 'Pay for this seat before upgrading it.');
      }
      if (reservation.tier === 'atelier') {
        throw conflict('already_atelier', 'This seat is already an Atelier bench.');
      }

      ctx.idempotencyKey();
      const billingName = readBillingName(body);
      const target = body['bench'];
      if (!isBenchLabel(target) || tierOfBench(target) !== 'atelier') {
        fieldError('bench', 'Choose an Atelier bench in row A or B.');
      }
      const bench = target as string;
      const split = upgradeSplit(reservation.state, venueDate());

      const claim = await withLedgerLock(async (client) => {
        await sweepLedger(client);
        const ledger = await computeLedger(client, account.id);
        const view = ledger.benches.find((candidate) => candidate.label === bench);
        if (view === undefined || view.state !== 'open') return 'bench_taken' as const;
        if (ledger.tiers.atelier.active >= ledger.tiers.atelier.cap) {
          return 'atelier_sold_out' as const;
        }
        await client.query(
          `update reservations
           set bench = $2, tier = 'atelier', price_cents = $3,
               upgrade_from_bench = bench, payment_in_flight = 'upgrade'
           where id = $1`,
          [id, bench, PRICES.atelier.fullCents],
        );
        return 'claimed' as const;
      });
      if (claim !== 'claimed') {
        throw conflict(
          claim,
          claim === 'bench_taken' ? 'That bench is no longer open.' : 'Every Atelier place is taken.',
          { waitlist: { tier: 'atelier', open: false } },
        );
      }

      try {
        const recorded = await chargeThroughKillBill({
          buyer: account,
          kind: 'upgrade',
          reservationId: id,
          groupId: null,
          externalKey: `ob-upgrade-${id}`,
          billingName,
          charges: [
            {
              reservationId: id,
              description: `Bench ${bench} Atelier upgrade`,
              amountCents: split.chargeNowCents,
            },
          ],
        });
        try {
          await finishPayment(recorded.paymentId);
        } catch (error) {
          if (error instanceof StorageUnavailable) return respondWithReservation(id, 202);
          throw error;
        }
        return respondWithReservation(id, 201);
      } catch (error) {
        if (error instanceof BillingUnavailable) {
          await withLedgerLock(async (client) => {
            await sweepLedger(client);
            const ledger = await computeLedger(client, account.id);
            const previous = reservation.bench;
            const view = ledger.benches.find((candidate) => candidate.label === previous);
            if (view !== undefined && view.state === 'open') {
              await client.query(
                `update reservations
                 set bench = $2, tier = $3, price_cents = $4,
                     upgrade_from_bench = null, payment_in_flight = null
                 where id = $1`,
                [id, previous, reservation.tier, reservation.price_cents],
              );
            } else {
              await client.query(
                `update reservations set upgrade_from_bench = null, payment_in_flight = null
                 where id = $1`,
                [id],
              );
            }
          });
        }
        throw error;
      }
    },
  },
  {
    method: 'POST',
    pattern: '/api/groups/:id/checkout',
    access: ['practitioner', 'clinic'],
    idempotent: true,
    handler: async (ctx) => {
      const account = ctx.signedIn();
      const id = ctx.param('id');
      const body = ctx.json();
      await sweepIfDue();

      const group = await pool.query<{ id: string; state: string; buyer_id: string }>(
        'select id, state, buyer_id from groups where id = $1',
        [id],
      );
      const groupRow = group.rows[0];
      if (groupRow === undefined || groupRow.buyer_id !== account.id) throw notFound();
      if (ctx.idempotencyConflict()) throw conflict('idempotency_conflict', IDEMPOTENCY_CONFLICT);

      const seats = await loadReservationsForGroup(pool, id);
      const at = serverNow();
      if (seats.some((seat) => SOLD_STATES.includes(seat.state))) {
        throw conflict('already_paid', 'This group invoice is already paid.');
      }
      if (seats.length === 0 || seats.some((seat) => !holdIsLive(seat, at))) {
        throw conflict('hold_expired', 'The hold on these benches has ended.');
      }

      ctx.idempotencyKey();
      const billingName = readBillingName(body);
      const assignments = readAssignments(body, seats);

      for (const assignment of assignments) {
        const engaged = await pool.query<{ taken: boolean }>(
          `select exists(
             select 1 from reservations r join accounts a on a.id = r.attendee_account_id
             where lower(a.email) = lower($1) and r.state = any($2::text[]) and r.group_id is distinct from $3
           ) as taken`,
          [assignment.email, SOLD_STATES, id],
        );
        if (engaged.rows[0]?.taken === true) {
          throw conflict('already_attending', 'That colleague already attends another seat.');
        }
      }

      await withLedgerLock(async (client) => {
        for (const assignment of assignments) {
          await client.query(
            `update reservations
             set assignee_name = $2, assignee_email = $3, assignee_email_lower = lower($3),
                 assignee_accepted = false, attendee_account_id = null,
                 assignment_seq = assignment_seq + 1
             where group_id = $1 and bench = $4`,
            [id, assignment.name, assignment.email, assignment.bench],
          );
        }
        await markPaymentInFlight(
          client,
          seats.map((seat) => seat.id),
          'group',
        );
      });

      const charges: SeatCharge[] = seats.map((seat) => ({
        reservationId: seat.id,
        description: `Bench ${seat.bench} ${tierName(seat.tier)} full price`,
        amountCents: seat.price_cents,
      }));

      try {
        const recorded = await chargeThroughKillBill({
          buyer: account,
          kind: 'group',
          reservationId: null,
          groupId: id,
          externalKey: `ob-group-${id}`,
          billingName,
          charges,
        });
        let status = 201;
        try {
          await finishPayment(recorded.paymentId);
        } catch (error) {
          if (error instanceof StorageUnavailable) status = 202;
          else throw error;
        }
        const refreshed = await loadGroupRow(pool, id);
        if (refreshed === null) throw notFound();
        return { status, body: { group: await serializeGroup(pool, refreshed, serverNow()) } };
      } catch (error) {
        if (error instanceof BillingUnavailable) {
          await clearPaymentInFlight(seats.map((seat) => seat.id));
          await sweepIfDue();
        }
        throw error;
      }
    },
  },
];

interface Assignment {
  readonly bench: string;
  readonly name: string;
  readonly email: string;
}

function readAssignments(
  body: Record<string, unknown>,
  seats: readonly ReservationDetail[],
): Assignment[] {
  const raw = body['assignments'];
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) fieldError('assignments', 'Send a list of seat assignments.');
  const benches = new Set(seats.map((seat) => seat.bench));
  const assignments: Assignment[] = [];
  for (const entry of raw as unknown[]) {
    if (entry === null || typeof entry !== 'object') {
      fieldError('assignments', 'Each assignment needs a bench, a name and an email.');
    }
    const record = entry as Record<string, unknown>;
    const bench = record['bench'];
    const name = record['name'];
    const email = record['email'];
    if (typeof bench !== 'string' || !benches.has(bench)) {
      fieldError('assignments', 'Each assignment must name a bench in this group.');
    }
    if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 120) {
      fieldError('assignments', 'Each assignment needs a colleague name of 1 to 120 characters.');
    }
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email.trim())) {
      fieldError('assignments', 'Each assignment needs a valid colleague email.');
    }
    assignments.push({
      bench: bench as string,
      name: (name as string).trim(),
      email: (email as string).trim(),
    });
  }
  return assignments;
}

export const cancelRoutes: readonly Route[] = [
  {
    method: 'POST',
    pattern: '/api/reservations/:id/cancel',
    access: ['practitioner', 'clinic'],
    handler: async (ctx) => {
      const account = ctx.signedIn();
      const id = ctx.param('id');
      await sweepIfDue();

      const outcome = await withLedgerLock(async (client) => {
        await sweepLedger(client);
        const reservation = await loadReservation(client, id);
        if (reservation === null || reservation.buyer_id !== account.id) return 'not_found' as const;
        if (!canTransition(reservation.state, 'cancelled')) return 'invalid' as const;
        const due = refundDueCents(venueDate(), reservation.purchased_cents);
        if (due === null) return 'no_window' as const;
        await client.query(
          `update reservations set state = 'cancelled', refund_due_cents = $2, cancelled_at = now()
           where id = $1`,
          [id, due],
        );
        await offerFreedBenches(client, [
          { bench: reservation.bench, tier: reservation.tier },
        ]);
        return 'cancelled' as const;
      });

      if (outcome === 'not_found') throw notFound();
      if (outcome === 'invalid') {
        throw conflict('invalid_transition', 'This seat cannot be cancelled from its state.');
      }
      if (outcome === 'no_window') {
        throw conflict('no_refund_window', 'Refunds closed on 19 March 2027.');
      }
      return respondWithReservation(id, 200);
    },
  },
];
