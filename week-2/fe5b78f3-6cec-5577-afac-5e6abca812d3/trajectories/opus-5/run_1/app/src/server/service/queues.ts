import type { Transaction } from '../db/pool';
import { recordHistory, setCurrentStatus } from '../data/bookings';
import type { HoldRecord, RunKey } from '../data/runs';
import { loadHolds, loadQueue } from '../data/runs';
import type { Promotion } from '../domain/promotion';
import type { WaitingList } from '../domain/schedule';
import type { PassengerStatus } from '../domain/status';
import { confirmed, racPlace, waitlisted } from '../domain/status';

export interface StatusChange {
  readonly pnr: string;
  readonly passengerNumber: number;
  readonly from: PassengerStatus;
  readonly to: PassengerStatus;
}

async function currentStatus(
  tx: Transaction,
  pnr: string,
  passengerNumber: number,
): Promise<PassengerStatus> {
  const rows = await tx.query<{ current_status: PassengerStatus }>(
    'select current_status from passengers where pnr = $1 and number = $2',
    [pnr, passengerNumber],
  );
  return rows[0].current_status;
}

export async function applyStatus(
  tx: Transaction,
  pnr: string,
  passengerNumber: number,
  next: PassengerStatus,
  at: number,
): Promise<StatusChange | null> {
  const from = await currentStatus(tx, pnr, passengerNumber);
  if (from.label === next.label) return null;
  await setCurrentStatus(tx, pnr, passengerNumber, next);
  await recordHistory(tx, pnr, passengerNumber, at, from.label, next.label);
  return { pnr, passengerNumber, from, to: next };
}

/** Writes a planned promotion: the new hold, the queue entry it leaves or joins, and the status. */
export async function applyPromotions(
  tx: Transaction,
  key: RunKey,
  promotions: readonly Promotion[],
  at: number,
): Promise<StatusChange[]> {
  const changes: StatusChange[] = [];
  for (const promotion of promotions) {
    if (promotion.kind === 'to_confirmed') {
      if (promotion.releasedPlace !== null) {
        await tx.query(
          `delete from holds where train_number = $1 and run_date = $2 and travel_class = $3
             and pnr = $4 and passenger_number = $5 and slot > 0`,
          [key.train, key.runDate, key.travelClass, promotion.pnr, promotion.passengerNumber],
        );
      }
      await tx.query(
        `delete from queue_entries where pnr = $1 and passenger_number = $2`,
        [promotion.pnr, promotion.passengerNumber],
      );
      const stretch = await bookingStretch(tx, promotion.pnr);
      await tx.query(
        `insert into holds (train_number, run_date, travel_class, coach, berth, slot, stretch,
           pnr, passenger_number)
         values ($1, $2, $3, $4, $5, 0, int4range($6, $7), $8, $9)`,
        [
          key.train, key.runDate, key.travelClass, promotion.coach, promotion.berth,
          stretch.fromSeq, stretch.toSeq, promotion.pnr, promotion.passengerNumber,
        ],
      );
      const change = await applyStatus(
        tx,
        promotion.pnr,
        promotion.passengerNumber,
        confirmed(promotion.coach, promotion.berth, promotion.berthType),
        at,
      );
      if (change !== null) changes.push(change);
      continue;
    }
    const tail = await tx.query<{ next: number }>(
      `select coalesce(max(position), 0) + 1 as next from queue_entries
       where train_number = $1 and run_date = $2 and travel_class = $3 and queue = 'RAC'`,
      [key.train, key.runDate, key.travelClass],
    );
    await tx.query(
      `update queue_entries set queue = 'RAC', position = $3
       where pnr = $1 and passenger_number = $2`,
      [promotion.pnr, promotion.passengerNumber, tail[0].next],
    );
    await tx.query(
      `insert into holds (train_number, run_date, travel_class, coach, berth, slot, stretch,
         pnr, passenger_number)
       values ($1, $2, $3, $4, $5, $6, int4range($7, $8), $9, $10)`,
      [
        key.train, key.runDate, key.travelClass, promotion.place.coach, promotion.place.berth,
        promotion.place.slot, promotion.place.fromSeq, promotion.place.toSeq,
        promotion.pnr, promotion.passengerNumber,
      ],
    );
  }
  return changes;
}

async function bookingStretch(
  tx: Transaction,
  pnr: string,
): Promise<{ fromSeq: number; toSeq: number }> {
  const rows = await tx.query<{ from_seq: number; to_seq: number }>(
    'select from_seq, to_seq from bookings where pnr = $1',
    [pnr],
  );
  return { fromSeq: rows[0].from_seq, toSeq: rows[0].to_seq };
}

function placeOf(holds: readonly HoldRecord[], pnr: string, passengerNumber: number): HoldRecord {
  const place = holds.find(
    (hold) => hold.pnr === pnr && hold.passengerNumber === passengerNumber && hold.slot > 0,
  );
  if (place === undefined) throw new Error(`no RAC place held by ${pnr}/${passengerNumber}`);
  return place;
}

/**
 * Brings every queued passenger's stored status in line with their queue entry, which is what
 * renumbering and promotion into RAC change.
 */
export async function syncQueueStatuses(
  tx: Transaction,
  key: RunKey,
  at: number,
): Promise<StatusChange[]> {
  const holds = await loadHolds(tx, key);
  const queue = await loadQueue(tx, key, holds);
  const changes: StatusChange[] = [];
  for (const entry of queue) {
    const next = entry.queue === 'RAC'
      ? ((): PassengerStatus => {
        const place = placeOf(holds, entry.pnr, entry.passengerNumber);
        return racPlace(entry.position, place.coach, place.berth);
      })()
      : waitlisted(entry.queue as WaitingList, entry.position);
    const change = await applyStatus(tx, entry.pnr, entry.passengerNumber, next, at);
    if (change !== null) changes.push(change);
  }
  return changes;
}
