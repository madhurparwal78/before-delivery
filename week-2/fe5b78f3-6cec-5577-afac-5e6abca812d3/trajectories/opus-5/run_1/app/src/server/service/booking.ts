import { randomInt } from 'node:crypto';
import type { Transaction } from '../db/pool';
import {
  findBooking,
  loadCancellations,
  loadHistory,
  loadPassengers,
  loadRefunds,
  loadTickets,
} from '../data/bookings';
import { lockRun, loadHolds, loadQueue, racCount, waitingCounts } from '../data/runs';
import { loadTrain } from '../data/trains';
import type { Allotment, PartyMember } from '../domain/allotment';
import { allotParty } from '../domain/allotment';
import type { WaitingCounts } from '../domain/availability';
import type { Quota, TravelClass } from '../domain/berths';
import { QUOTA_LABEL, isLowerBerth } from '../domain/berths';
import { quoteFare } from '../domain/fare';
import { RunInventory, waitlistCap } from '../domain/inventory';
import type { StopRow, TrainRow } from '../domain/schedule';
import { coachesOfClass, generalWaitingList } from '../domain/schedule';
import type { AcceptedStatus, PassengerStatus } from '../domain/status';
import {
  NO_BERTH_CHILD,
  acceptForStatus,
  acceptRank,
  confirmed,
  racPlace,
  statusRank,
  waitlisted,
} from '../domain/status';
import type { Account, AppServices } from '../http/context';
import { errors } from '../http/errors';
import { PaymentUnavailableError } from '../services/killbill';
import { TicketStorage, TicketStorageUnavailableError } from '../services/storage';
import { queueMail } from './outbox';
import { bookingBody } from './projection';
import type { TicketPayload } from './tickets';
import { renderTicket, reserveTicketVersion } from './tickets';
import type { PassengerInput } from './validate';

export interface BookingCommand {
  readonly train: TrainRow;
  readonly runDate: string;
  readonly fromStop: StopRow;
  readonly toStop: StopRow;
  readonly travelClass: TravelClass;
  readonly quota: Quota;
  readonly passengers: readonly PassengerInput[];
  readonly keepInOneCoach: boolean;
  readonly lowerBerthOnly: boolean;
  readonly accept: AcceptedStatus;
  readonly contactPhone: string;
}

async function newPnr(tx: Transaction): Promise<string> {
  for (;;) {
    let pnr = String(randomInt(1, 10));
    for (let digit = 0; digit < 9; digit += 1) pnr += String(randomInt(0, 10));
    const taken = await tx.query<{ pnr: string }>('select pnr from bookings where pnr = $1', [pnr]);
    if (taken.length === 0) return pnr;
  }
}

class QueuePositions {
  private rac: number;
  private readonly waiting: Record<string, number>;

  constructor(racUsed: number, counts: WaitingCounts) {
    this.rac = racUsed;
    this.waiting = { ...counts };
  }

  nextRac(): number {
    this.rac += 1;
    return this.rac;
  }

  nextWaiting(list: string): number {
    this.waiting[list] = (this.waiting[list] ?? 0) + 1;
    return this.waiting[list];
  }
}

function toStatus(allotment: Allotment, positions: QueuePositions): PassengerStatus {
  switch (allotment.kind) {
    case 'NOSB':
      return NO_BERTH_CHILD;
    case 'CNF':
      return confirmed(allotment.coach, allotment.berth, allotment.berthType);
    case 'RAC':
      return racPlace(positions.nextRac(), allotment.coach, allotment.berth);
    case 'WL':
      return waitlisted(allotment.list, positions.nextWaiting(allotment.list));
  }
}

/** Options and acceptance: each failure books nobody, holds nothing and charges nothing. */
function assertOptionsMet(statuses: readonly PassengerStatus[], command: BookingCommand): void {
  const berthed = statuses.filter((status) => status.status === 'CNF');
  const berthable = statuses.filter((status) => status.status !== 'NOSB');
  if (command.keepInOneCoach) {
    const coaches = new Set(berthed.map((status) => status.coach));
    if (berthed.length !== berthable.length || coaches.size > 1) throw errors.partySplit();
  }
  if (command.lowerBerthOnly) {
    const lower = berthed.some(
      (status) => status.berth_type !== null && isLowerBerth(status.berth_type),
    );
    if (!lower) throw errors.noLowerBerth();
  }
  const accepted = acceptRank(command.accept);
  const ranked = statuses.map((status) => ({ status, rank: statusRank(status.status) }));
  const affected = ranked.find((entry) => entry.rank > accepted);
  if (affected === undefined) return;
  const worst = ranked.reduce((a, b) => (b.rank > a.rank ? b : a));
  throw errors.availabilityChanged(acceptForStatus(worst.status.status), affected.status.label);
}

export async function createBooking(
  app: AppServices,
  account: Account,
  command: BookingCommand,
  now: number,
): Promise<Record<string, unknown>> {
  const { train, runDate, fromStop, toStop, travelClass, quota } = command;
  const stretch = { fromSeq: fromStop.seq, toSeq: toStop.seq };
  const fare = quoteFare(
    command.passengers.map((passenger) => passenger.age),
    toStop.km - fromStop.km,
    travelClass,
    quota,
  );
  const generalList = generalWaitingList(fromStop);

  const pnr = await app.database.transaction(async (tx) => {
    const key = { train: train.number, runDate, travelClass };
    await lockRun(tx, key);
    const holds = await loadHolds(tx, key);
    const queue = await loadQueue(tx, key, holds);
    const coaches = coachesOfClass(train, travelClass);
    const inventory = new RunInventory(coaches, holds);
    const counts = waitingCounts(queue);
    const cap = waitlistCap(coaches.length, travelClass, quota === 'TQ' ? 'TQ' : 'GN');
    const used = quota === 'TQ' ? counts.TQWL : counts.GNWL + counts.RLWL + counts.PQWL;

    const party: PartyMember[] = command.passengers.map((passenger) => ({
      age: passenger.age,
      gender: passenger.gender,
      preference: passenger.berth_preference,
    }));
    const outcome = allotParty(inventory, {
      travelClass,
      quota,
      stretch,
      party,
      keepInOneCoach: command.keepInOneCoach,
      generalList,
      waitlistRoom: Math.max(cap - used, 0),
    });
    if (outcome.outcome === 'quota_full') throw errors.quotaFull(QUOTA_LABEL[quota]);
    if (outcome.outcome === 'waitlist_full') throw errors.waitlistFull();

    const positions = new QueuePositions(racCount(queue), counts);
    const statuses = outcome.allotments.map((allotment) => toStatus(allotment, positions));
    assertOptionsMet(statuses, command);

    const booked = await newPnr(tx);
    await tx.query(
      `insert into bookings (pnr, account_id, train_number, run_date, travel_class, quota,
         from_code, to_code, from_seq, to_seq, keep_in_one_coach, lower_berth_only, contact_phone,
         total_paise, fare_lines, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
         to_timestamp($16 / 1000.0))`,
      [
        booked, account.id, train.number, runDate, travelClass, quota,
        fromStop.code, toStop.code, fromStop.seq, toStop.seq,
        command.keepInOneCoach, command.lowerBerthOnly, command.contactPhone,
        fare.total_paise, JSON.stringify(fare.lines), now,
      ],
    );

    for (const [index, passenger] of command.passengers.entries()) {
      const status = statuses[index];
      await tx.query(
        `insert into passengers (pnr, number, name, age, gender, berth_preference, fare_paise,
           booking_status, current_status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
        [
          booked, index + 1, passenger.name, passenger.age, passenger.gender,
          passenger.berth_preference, fare.perPassenger[index].total, JSON.stringify(status),
        ],
      );
      const allotment = outcome.allotments[index];
      if (allotment.kind === 'CNF' || allotment.kind === 'RAC') {
        await tx.query(
          `insert into holds (train_number, run_date, travel_class, coach, berth, slot, stretch,
             pnr, passenger_number)
           values ($1, $2, $3, $4, $5, $6, int4range($7, $8), $9, $10)`,
          [
            train.number, runDate, travelClass, allotment.coach, allotment.berth,
            allotment.kind === 'RAC' ? allotment.slot : 0,
            stretch.fromSeq, stretch.toSeq, booked, index + 1,
          ],
        );
      }
      if (allotment.kind === 'RAC' || allotment.kind === 'WL') {
        await tx.query(
          `insert into queue_entries (train_number, run_date, travel_class, queue, position,
             pnr, passenger_number)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [
            train.number, runDate, travelClass,
            allotment.kind === 'RAC' ? 'RAC' : allotment.list,
            status.position, booked, index + 1,
          ],
        );
      }
    }

    const payload: TicketPayload = {
      pnr: booked,
      train_number: train.number,
      train_name: train.name,
      run_date: runDate,
      from: fromStop.code,
      to: toStop.code,
      travel_class: travelClass,
      quota,
      total_paise: fare.total_paise,
      kind: 'booked',
      passengers: command.passengers.map((passenger, index) => ({
        number: index + 1,
        name: passenger.name,
        age: passenger.age,
        label: statuses[index].label,
      })),
    };
    const version = await reserveTicketVersion(tx, booked, 'booked', now, payload);

    let paymentId: string | null = null;
    try {
      const killbillAccountId = account.killbill_account_id
        ?? await app.killbill.ensureAccount(account.id, account.name);
      if (account.killbill_account_id === null) {
        await tx.query('update accounts set killbill_account_id = $2 where id = $1', [
          account.id, killbillAccountId,
        ]);
      }
      const purchase = await app.killbill.purchase(killbillAccountId, booked, fare.total_paise);
      paymentId = purchase.paymentId;
      await tx.query('update bookings set killbill_payment_id = $2 where pnr = $1', [
        booked, paymentId,
      ]);
      const { etag } = await app.storage.put(
        TicketStorage.objectKey(booked, version, 'booked'),
        renderTicket(payload),
      );
      await tx.query('update tickets set stored = true, etag = $3 where pnr = $1 and version = $2', [
        booked, version, etag,
      ]);
    } catch (error) {
      if (paymentId !== null) {
        await app.killbill.refund(paymentId, `${booked}-void`, fare.total_paise).catch(() => false);
      }
      if (error instanceof PaymentUnavailableError) throw errors.paymentUnavailable();
      if (error instanceof TicketStorageUnavailableError) throw errors.ticketStorageUnavailable();
      throw error;
    }

    await queueMail(tx, {
      dedupeKey: `eticket:${booked}`,
      to: account.email,
      subject: `E-ticket for PNR ${booked}`,
      body: [
        `PNR ${booked}`,
        `${train.number} ${train.name} on ${runDate}`,
        '',
        ...statuses.map((status, index) => `Passenger ${index + 1}: ${status.label}`),
      ].join('\n'),
      attachPnr: booked,
      attachVersion: version,
    });
    return booked;
  });

  return loadBookingBody(app, pnr, now);
}

export async function loadBookingBody(
  app: AppServices,
  pnr: string,
  now: number,
): Promise<Record<string, unknown>> {
  const record = await findBooking(app.database, pnr);
  if (record === null) throw errors.notFound();
  const train = await loadTrain(app.database, record.train_number);
  if (train === null) throw errors.notFound();
  return bookingBody(
    {
      booking: record,
      passengers: await loadPassengers(app.database, pnr),
      history: await loadHistory(app.database, pnr),
      cancellations: await loadCancellations(app.database, pnr),
      refunds: await loadRefunds(app.database, pnr),
      tickets: await loadTickets(app.database, pnr),
      train,
    },
    now,
  );
}
