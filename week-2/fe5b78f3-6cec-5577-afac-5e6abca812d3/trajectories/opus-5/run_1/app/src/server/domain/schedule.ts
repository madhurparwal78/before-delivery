import type { TravelClass } from './berths';
import { istAt, minutesOfDay } from './ist';

export interface StopRow {
  readonly seq: number;
  readonly code: string;
  readonly name: string;
  readonly km: number;
  readonly time: string;
  readonly dayOffset: number;
  readonly remote: boolean;
}

export interface CoachRow {
  readonly code: string;
  readonly travelClass: TravelClass;
  readonly seq: number;
}

export interface TrainRow {
  readonly number: string;
  readonly name: string;
  readonly stops: readonly StopRow[];
  readonly coaches: readonly CoachRow[];
}

export interface RunStop extends StopRow {
  readonly at: number;
}

const HOUR = 3_600_000;

/** Absolute IST instants for each stop of one run, keyed by the date the train leaves its origin. */
export function runStops(train: TrainRow, runDate: string): RunStop[] {
  return train.stops.map((stop) => ({ ...stop, at: istAt(runDate, stop.time, stop.dayOffset) }));
}

/**
 * Chart time. A train leaving its origin from 14:01 through 05:00 IST has its chart 10 hours
 * before departure; one leaving from 05:01 through 14:00 has its chart 8 hours before.
 */
export function chartAt(train: TrainRow, runDate: string): number {
  const origin = train.stops[0];
  const departure = istAt(runDate, origin.time, origin.dayOffset);
  const minutes = minutesOfDay(origin.time);
  const tenHourBand = minutes >= minutesOfDay('14:01') || minutes <= minutesOfDay('05:00');
  return departure - (tenHourBand ? 10 : 8) * HOUR;
}

export function coachesOfClass(train: TrainRow, travelClass: TravelClass): CoachRow[] {
  return train.coaches
    .filter((coach) => coach.travelClass === travelClass)
    .sort((a, b) => a.seq - b.seq);
}

export function findStop(stops: readonly StopRow[], code: string): StopRow | null {
  return stops.find((stop) => stop.code === code) ?? null;
}

export function stopBySeq<T extends StopRow>(stops: readonly T[], seq: number): T {
  const stop = stops.find((entry) => entry.seq === seq);
  if (stop === undefined) throw new Error(`stop ${seq} is not on this run`);
  return stop;
}

export type WaitingList = 'GNWL' | 'RLWL' | 'PQWL' | 'TQWL';

/** The waiting list a General booking joins, decided by the boarding stop. */
export function generalWaitingList(from: StopRow): Exclude<WaitingList, 'TQWL'> {
  if (from.seq === 1) return 'GNWL';
  return from.remote ? 'RLWL' : 'PQWL';
}
