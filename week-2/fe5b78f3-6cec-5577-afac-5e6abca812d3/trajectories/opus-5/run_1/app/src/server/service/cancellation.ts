import type { BookingRecord, CancellationPassenger, PassengerRecord } from '../data/bookings';
import { bumpVersion, loadPassengers } from '../data/bookings';
import type { RunKey } from '../data/runs';
import { lockRun, loadHolds, loadQueue, renumberQueues } from '../data/runs';
import type { Deduction } from '../domain/bands';
import { computeDeduction } from '../domain/bands';
import { isChild } from '../domain/fare';
import { istTimestamp } from '../domain/ist';
import { RunInventory } from '../domain/inventory';
import type { HeldPlace } from '../domain/inventory';
import type { Paise } from '../domain/money';
import type { FreedBerth } from '../domain/promotion';
import { planPromotions } from '../domain/promotion';
import { berthSpec } from '../domain/berths';
import type { TrainRow } from '../domain/schedule';
import { coachesOfClass } from '../domain/schedule';
import { CANCELLED, isFinalStatus, isWaitingList } from '../domain/status';
import type { AppServices } from '../http/context';
import { errors } from '../http/errors';
import { announcementLine } from './announce';
import { loadBookingBody } from './booking';
import { queueMail } from './outbox';
import { effectiveStatus, runFacts } from './projection';
import { applyPromotions, applyStatus, syncQueueStatuses } from './queues';
import type { StatusChange } from './queues';
import type { TicketPayload } from './tickets';
import { renderTicket, reserveTicketVersion } from './tickets';
import { tryIssueRefund } from './refunds';
import { TicketStorage, TicketStorageUnavailableError } from '../services/storage';

export interface CancellationQuote {
  readonly quoted_at: string;
  readonly passengers: readonly CancellationPassenger[];
  readonly refund_paise: Paise;
}

/**
 * A cancellation on a General PNR qualifies for part-confirmed party clerkage when it takes every
 * remaining passenger aged 5 or over and those include both a confirmed and a queued passenger.
 */
function isPartConfirmedParty(
  booking: BookingRecord,
  passengers: readonly PassengerRecord[],
  selected: readonly number[],
  chartPrepared: boolean,
): boolean {
  if (booking.quota !== 'GN' || chartPrepared) return false;
  const live = passengers.filter(
    (passenger) => !isChild(passenger.age) && !isFinalStatus(passenger.current_status.status),
  );
  if (live.length === 0) return false;
  if (!live.every((passenger) => selected.includes(passenger.number))) return false;
  const statuses = live.map((passenger) => passenger.current_status.status);
  return statuses.includes('CNF')
    && statuses.some((status) => status === 'RAC' || isWaitingList(status));
}

export function quoteCancellation(
  booking: BookingRecord,
  train: TrainRow,
  passengers: readonly PassengerRecord[],
  selected: readonly number[],
  now: number,
): CancellationQuote {
  const facts = runFacts(booking, train, now);
  const partConfirmedParty = isPartConfirmedParty(booking, passengers, selected, facts.chartPrepared);
  const quoted = selected.map((number) => {
    const passenger = passengers.find((entry) => entry.number === number);
    if (passenger === undefined) throw errors.notFound();
    const deduction: Deduction = computeDeduction({
      status: effectiveStatus(passenger.current_status, facts.chartPrepared).status,
      age: passenger.age,
      quota: booking.quota,
      travelClass: booking.travel_class,
      farePaise: passenger.fare_paise,
      now,
      chartInstant: facts.chartInstant,
      departureAt: facts.departureAt,
      partConfirmedParty: partConfirmedParty && !isChild(passenger.age),
    });
    return { number, ...deduction };
  });
  return {
    quoted_at: istTimestamp(now),
    passengers: quoted,
    refund_paise: quoted.reduce((sum, entry) => sum + entry.refund_paise, 0),
  };
}

/** Rejects a selection the way the precedence rule asks: state conflicts, then field errors. */
export function assertCancellable(
  booking: BookingRecord,
  train: TrainRow,
  passengers: readonly PassengerRecord[],
  selected: readonly number[],
  now: number,
): void {
  const facts = runFacts(booking, train, now);
  for (const number of selected) {
    const passenger = passengers.find((entry) => entry.number === number);
    if (passenger === undefined) continue;
    const status = effectiveStatus(passenger.current_status, facts.chartPrepared);
    if (isFinalStatus(status.status)) throw errors.alreadyCancelled();
  }
  if (facts.journeyComplete) throw errors.journeyComplete();
}

export async function cancelPassengers(
  app: AppServices,
  booking: BookingRecord,
  train: TrainRow,
  selected: readonly number[],
  now: number,
): Promise<Record<string, unknown>> {
  const key: RunKey = {
    train: booking.train_number,
    runDate: booking.run_date,
    travelClass: booking.travel_class,
  };
  const result = await app.database.transaction(async (tx) => {
    await lockRun(tx, key);
    const passengers = await loadPassengers(tx, booking.pnr);
    assertCancellable(booking, train, passengers, selected, now);
    const facts = runFacts(booking, train, now);
    const quote = quoteCancellation(booking, train, passengers, selected, now);

    const holds = await loadHolds(tx, key);
    const queue = await loadQueue(tx, key, holds);
    const coaches = coachesOfClass(train, booking.travel_class);
    const inventory = new RunInventory(coaches, holds);

    const cancelling = [...selected];
    const remainingAdults = passengers.filter(
      (passenger) => !isChild(passenger.age)
        && !isFinalStatus(passenger.current_status.status)
        && !selected.includes(passenger.number),
    );
    if (remainingAdults.length === 0) {
      for (const passenger of passengers) {
        if (isChild(passenger.age)
          && !isFinalStatus(passenger.current_status.status)
          && !cancelling.includes(passenger.number)) {
          cancelling.push(passenger.number);
        }
      }
    }

    const freedBerths: FreedBerth[] = [];
    const freedPlaces: HeldPlace[] = [];
    const ownChanges: StatusChange[] = [];
    for (const number of cancelling) {
      for (const hold of holds.filter(
        (entry) => entry.pnr === booking.pnr && entry.passengerNumber === number,
      )) {
        inventory.remove(hold);
        if (hold.slot === 0) {
          freedBerths.push({
            coach: hold.coach,
            berth: hold.berth,
            pool: berthSpec(hold.berth).pool,
            fromSeq: hold.fromSeq,
            toSeq: hold.toSeq,
          });
        } else {
          freedPlaces.push({
            coach: hold.coach,
            berth: hold.berth,
            slot: hold.slot,
            fromSeq: hold.fromSeq,
            toSeq: hold.toSeq,
          });
        }
      }
      await tx.query('delete from holds where pnr = $1 and passenger_number = $2', [
        booking.pnr, number,
      ]);
      await tx.query('delete from queue_entries where pnr = $1 and passenger_number = $2', [
        booking.pnr, number,
      ]);
      const change = await applyStatus(tx, booking.pnr, number, CANCELLED, now);
      if (change !== null) ownChanges.push(change);
    }

    /** No promotion happens from the chart instant: a freed berth stays empty. */
    const waiting = queue.filter(
      (entry) => !(entry.pnr === booking.pnr && cancelling.includes(entry.passengerNumber)),
    );
    const promotions = facts.chartPrepared
      ? []
      : planPromotions(inventory, waiting, freedBerths, freedPlaces);
    const promotionChanges = await applyPromotions(tx, key, promotions, now);
    await renumberQueues(tx, key);
    const queueChanges = await syncQueueStatuses(tx, key, now);

    const numbers = await tx.query<{ next: number }>(
      'select coalesce(max(number), 0) + 1 as next from cancellations where pnr = $1',
      [booking.pnr],
    );
    const cancellationNumber = numbers[0].next;
    await tx.query(
      `insert into cancellations (pnr, number, requested_at, refund_paise, passengers)
       values ($1, $2, to_timestamp($3 / 1000.0), $4, $5)`,
      [
        booking.pnr, cancellationNumber, now, quote.refund_paise,
        JSON.stringify(quote.passengers),
      ],
    );
    let refundNumber: number | null = null;
    if (quote.refund_paise > 0) {
      const refundRows = await tx.query<{ next: number }>(
        'select coalesce(max(number), 0) + 1 as next from refunds where pnr = $1',
        [booking.pnr],
      );
      refundNumber = refundRows[0].next;
      await tx.query(
        `insert into refunds (pnr, number, reason, refund_paise, status)
         values ($1, $2, 'cancellation', $3, 'pending')`,
        [booking.pnr, refundNumber, quote.refund_paise],
      );
    }

    const afterPassengers = await loadPassengers(tx, booking.pnr);
    const payload: TicketPayload = {
      pnr: booking.pnr,
      train_number: train.number,
      train_name: train.name,
      run_date: booking.run_date,
      from: booking.from_code,
      to: booking.to_code,
      travel_class: booking.travel_class,
      quota: booking.quota,
      total_paise: booking.total_paise,
      kind: 'cancellation',
      passengers: afterPassengers.map((passenger) => ({
        number: passenger.number,
        name: passenger.name,
        age: passenger.age,
        label: effectiveStatus(passenger.current_status, facts.chartPrepared).label,
      })),
    };
    const ticketVersion = await reserveTicketVersion(
      tx,
      booking.pnr,
      'cancellation',
      now,
      payload,
    );
    try {
      const { etag } = await app.storage.put(
        TicketStorage.objectKey(booking.pnr, ticketVersion, 'cancellation'),
        renderTicket(payload),
      );
      await tx.query('update tickets set stored = true, etag = $3 where pnr = $1 and version = $2', [
        booking.pnr, ticketVersion, etag,
      ]);
    } catch (error) {
      if (!(error instanceof TicketStorageUnavailableError)) throw error;
    }

    await bumpVersion(tx, booking.pnr);
    const movedPnrs = new Set(promotions.map((promotion) => promotion.pnr));
    const touched = new Set<string>([
      ...movedPnrs,
      ...promotionChanges.map((change) => change.pnr),
      ...queueChanges.map((change) => change.pnr),
    ]);
    for (const other of touched) {
      if (other !== booking.pnr) await bumpVersion(tx, other);
    }

    const allChanges = [...promotionChanges, ...queueChanges];
    for (const movedPnr of movedPnrs) {
      const lines = allChanges
        .filter((change) => change.pnr === movedPnr)
        .sort((a, b) => a.passengerNumber - b.passengerNumber)
        .map((change) => announcementLine(change.passengerNumber, change.from, change.to));
      if (lines.length === 0) continue;
      const owner = await tx.query<{ email: string }>(
        'select a.email from bookings b join accounts a on a.id = b.account_id where b.pnr = $1',
        [movedPnr],
      );
      await queueMail(tx, {
        dedupeKey: `moved:${movedPnr}:${booking.pnr}:${cancellationNumber}`,
        to: owner[0].email,
        subject: `Your status moved: PNR ${movedPnr}`,
        body: lines.join('\n'),
      });
    }

    return { cancellationNumber, refundNumber };
  });

  if (result.refundNumber !== null) {
    void tryIssueRefund(app, booking.pnr, result.refundNumber).catch(() => undefined);
  }

  const body = await loadBookingBody(app, booking.pnr, now);
  const cancellations = body.cancellations as { number: number }[];
  const refunds = body.refunds as { number: number }[];
  return {
    cancellation: cancellations.find((entry) => entry.number === result.cancellationNumber),
    refund: result.refundNumber === null
      ? null
      : refunds.find((entry) => entry.number === result.refundNumber) ?? null,
    booking: body,
  };
}
