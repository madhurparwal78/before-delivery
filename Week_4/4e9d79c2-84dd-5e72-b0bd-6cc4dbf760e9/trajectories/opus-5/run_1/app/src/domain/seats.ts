import { Size } from './vehicles.js';

const WHEELCHAIR_SEATS = ['2A', '2B'];

/** Every seat label of a vehicle, in order. Rows of 2 + 2, or 2 + 1 on the 8-seat. */
export function seatLabels(seats: Size): string[] {
  const perRow = seats === 8 ? 3 : 4;
  const letters = ['A', 'B', 'C', 'D'];
  const labels: string[] = [];
  let row = 1;
  let made = 0;
  while (made < seats) {
    const left = Math.min(perRow, seats - made);
    for (let index = 0; index < left; index += 1) labels.push(`${row}${letters[index]}`);
    made += left;
    row += 1;
  }
  return labels;
}

export function isWheelchairSeat(seat: string): boolean {
  return WHEELCHAIR_SEATS.includes(seat);
}

export function wheelchairSeatsOf(seats: Size): string[] {
  return seats === 16 || seats === 49 ? [...WHEELCHAIR_SEATS] : [];
}

export function nextEmptySeat(seats: Size, taken: Set<string>, wheelchair: boolean): string | null {
  const order = wheelchair ? wheelchairSeatsOf(seats) : seatLabels(seats).filter((seat) => !isWheelchairSeat(seat));
  for (const seat of order) {
    if (!taken.has(seat)) return seat;
  }
  if (!wheelchair) {
    for (const seat of seatLabels(seats)) {
      if (!taken.has(seat)) return seat;
    }
  }
  return null;
}

/** One adult per 15 pupils or part of 15. */
export function adultsNeeded(pupils: number): number {
  return Math.ceil(pupils / 15);
}
