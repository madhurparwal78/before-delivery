import { compareSeatIds } from '../../shared/seats';
import type { SeatView } from '../../shared/wire';

export type Direction = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';
type Spot = Pick<SeatView, 'seatId' | 'row' | 'column'>;

export function lowestSeat(seats: readonly Spot[]): string | null {
  return seats.map((seat) => seat.seatId).sort(compareSeatIds)[0] ?? null;
}

/**
 * The seat the cursor moves to: a seat in the same row (Left, Right) or column (Up, Down) wins first, then the
 * nearest seat by straight-line distance among seats lying in that direction; ties go to the lower seat id.
 * At the edge the cursor stays put.
 */
export function moveCursor(seats: readonly Spot[], from: string, direction: Direction): string {
  const here = seats.find((seat) => seat.seatId === from);
  if (!here) return from;
  const horizontal = direction === 'ArrowLeft' || direction === 'ArrowRight';
  const sign = direction === 'ArrowLeft' || direction === 'ArrowUp' ? -1 : 1;
  const ahead = seats.filter((seat) => (horizontal ? seat.column - here.column : seat.row - here.row) * sign > 0);
  const aligned = ahead.filter((seat) => (horizontal ? seat.row === here.row : seat.column === here.column));
  const distance = (seat: Spot) => (seat.row - here.row) ** 2 + (seat.column - here.column) ** 2;
  const best = [...(aligned.length > 0 ? aligned : ahead)].sort((a, b) => distance(a) - distance(b) || compareSeatIds(a.seatId, b.seatId))[0];
  return best?.seatId ?? from;
}
