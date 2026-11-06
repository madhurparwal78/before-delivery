import type { Transaction } from '../db/pool';
import type { TravelClass } from '../domain/berths';
import type { WaitingCounts } from '../domain/availability';
import { EMPTY_WAITING_COUNTS } from '../domain/availability';
import type { HeldPlace } from '../domain/inventory';
import type { QueuedPassenger } from '../domain/promotion';
import type { WaitingList } from '../domain/schedule';

export interface RunKey {
  readonly train: string;
  readonly runDate: string;
  readonly travelClass: TravelClass;
}

export interface HoldRecord extends HeldPlace {
  readonly pnr: string;
  readonly passengerNumber: number;
}

/** Allotment and payment are decided one booking at a time per run and class. */
export async function lockRun(tx: Transaction, key: RunKey): Promise<void> {
  await tx.query('select pg_advisory_xact_lock(hashtext($1))', [
    `${key.train}/${key.runDate}/${key.travelClass}`,
  ]);
}

export async function loadHolds(tx: Transaction, key: RunKey): Promise<HoldRecord[]> {
  const rows = await tx.query<{
    coach: string;
    berth: number;
    slot: number;
    from_seq: number;
    to_seq: number;
    pnr: string;
    passenger_number: number;
  }>(
    `select coach, berth, slot, lower(stretch) as from_seq, upper(stretch) as to_seq,
            pnr, passenger_number
     from holds
     where train_number = $1 and run_date = $2 and travel_class = $3`,
    [key.train, key.runDate, key.travelClass],
  );
  return rows.map((row) => ({
    coach: row.coach,
    berth: row.berth,
    slot: row.slot,
    fromSeq: row.from_seq,
    toSeq: row.to_seq,
    pnr: row.pnr,
    passengerNumber: row.passenger_number,
  }));
}

export async function loadQueue(
  tx: Transaction,
  key: RunKey,
  holds: readonly HoldRecord[],
): Promise<QueuedPassenger[]> {
  const rows = await tx.query<{
    queue: WaitingList | 'RAC';
    position: number;
    pnr: string;
    passenger_number: number;
    from_seq: number;
    to_seq: number;
  }>(
    `select q.queue, q.position, q.pnr, q.passenger_number, b.from_seq, b.to_seq
     from queue_entries q join bookings b on b.pnr = q.pnr
     where q.train_number = $1 and q.run_date = $2 and q.travel_class = $3
     order by q.queue, q.position`,
    [key.train, key.runDate, key.travelClass],
  );
  return rows.map((row) => {
    const place = row.queue === 'RAC'
      ? holds.find(
        (hold) => hold.pnr === row.pnr && hold.passengerNumber === row.passenger_number && hold.slot > 0,
      ) ?? null
      : null;
    return {
      pnr: row.pnr,
      passengerNumber: row.passenger_number,
      queue: row.queue,
      position: row.position,
      fromSeq: row.from_seq,
      toSeq: row.to_seq,
      place: place === null
        ? null
        : {
          coach: place.coach,
          berth: place.berth,
          slot: place.slot,
          fromSeq: place.fromSeq,
          toSeq: place.toSeq,
        },
    };
  });
}

export function waitingCounts(queue: readonly QueuedPassenger[]): WaitingCounts {
  const counts: Record<WaitingList, number> = { ...EMPTY_WAITING_COUNTS };
  for (const entry of queue) {
    if (entry.queue !== 'RAC') counts[entry.queue] += 1;
  }
  return counts;
}

export function racCount(queue: readonly QueuedPassenger[]): number {
  return queue.filter((entry) => entry.queue === 'RAC').length;
}

/** RAC and each waiting list are renumbered from 1 upward, without gaps, keeping their order. */
export async function renumberQueues(tx: Transaction, key: RunKey): Promise<string[]> {
  const rows = await tx.query<{
    id: number;
    queue: string;
    position: number;
    pnr: string;
    passenger_number: number;
  }>(
    `select id, queue, position, pnr, passenger_number from queue_entries
     where train_number = $1 and run_date = $2 and travel_class = $3
     order by queue, position, id`,
    [key.train, key.runDate, key.travelClass],
  );
  const nextPosition = new Map<string, number>();
  const renumbered: string[] = [];
  for (const row of rows) {
    const position = (nextPosition.get(row.queue) ?? 0) + 1;
    nextPosition.set(row.queue, position);
    if (position === row.position) continue;
    await tx.query('update queue_entries set position = $2 where id = $1', [row.id, position]);
    renumbered.push(`${row.pnr}/${row.passenger_number}`);
  }
  return renumbered;
}
