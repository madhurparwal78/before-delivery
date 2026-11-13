
export type SeatLegStatus = 'free' | 'taken';

export interface SeatClaim {
  seatNumbers: readonly number[];
  boardingIdx: number;
  alightingIdx: number;
}

export interface SeatMapEntry {
  seat: number;
  legs: SeatLegStatus[];
}

/**
 * The one place that decides which seats are taken on which legs. A claim is a confirmed
 * booking, a pending request or a live hold.
 */
export function buildSeatMap(
  rideSeats: number,
  legCount: number,
  claims: readonly SeatClaim[],
): SeatMapEntry[] {
  const map: SeatMapEntry[] = [];
  for (let seat = 1; seat <= rideSeats; seat += 1) {
    map.push({ seat, legs: Array.from({ length: legCount }, (): SeatLegStatus => 'free') });
  }
  for (const claim of claims) {
    for (const seat of claim.seatNumbers) {
      const entry = map[seat - 1];
      if (!entry) continue;
      for (let leg = claim.boardingIdx; leg < claim.alightingIdx; leg += 1) {
        entry.legs[leg] = 'taken';
      }
    }
  }
  return map;
}

/** A seat is free for a span only if it is free on every leg of the span. */
export function freeSeatsForSpan(
  map: readonly SeatMapEntry[],
  boardingIdx: number,
  alightingIdx: number,
): number[] {
  const free: number[] = [];
  for (const entry of map) {
    let open = true;
    for (let leg = boardingIdx; leg < alightingIdx; leg += 1) {
      if (entry.legs[leg] === 'taken') {
        open = false;
        break;
      }
    }
    if (open) free.push(entry.seat);
  }
  return free;
}

/** The server assigns the lowest-numbered seats that are free on every leg of the span. */
export function assignSeats(
  map: readonly SeatMapEntry[],
  boardingIdx: number,
  alightingIdx: number,
  count: number,
): number[] | null {
  const free = freeSeatsForSpan(map, boardingIdx, alightingIdx);
  if (free.length < count) return null;
  return free.slice(0, count);
}

/** The most seats used on any one leg, which is the floor for a seat edit. */
export function maxSeatsUsedOnAnyLeg(legCount: number, claims: readonly SeatClaim[]): number {
  const perLeg = Array.from({ length: legCount }, () => 0);
  for (const claim of claims) {
    for (let leg = claim.boardingIdx; leg < claim.alightingIdx; leg += 1) {
      perLeg[leg] = (perLeg[leg] ?? 0) + claim.seatNumbers.length;
    }
  }
  return perLeg.reduce((most, used) => Math.max(most, used), 0);
}

/**
 * `Seat 1: taken from Kestrevel to Brisanne, free from Brisanne to Tollemarch` — runs of
 * legs with the same status merge into one phrase, in route order.
 */
export function seatBandName(entry: SeatMapEntry, cities: readonly string[]): string {
  const runs: string[] = [];
  let runStart = 0;
  for (let leg = 0; leg < entry.legs.length; leg += 1) {
    const isLast = leg === entry.legs.length - 1;
    if (isLast || entry.legs[leg] !== entry.legs[leg + 1]) {
      runs.push(
        `${entry.legs[leg]} from ${cities[runStart] as string} to ${cities[leg + 1] as string}`,
      );
      runStart = leg + 1;
    }
  }
  return `Seat ${entry.seat}: ${runs.join(', ')}`;
}
