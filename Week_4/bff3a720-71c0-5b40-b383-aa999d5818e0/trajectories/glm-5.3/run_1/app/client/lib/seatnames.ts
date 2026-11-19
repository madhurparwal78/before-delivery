import type { Ride, SeatRow } from './types.js';

/**
 * Seat band names: `Seat <n>: ` followed by the merged runs of its whole route.
 * Decided in this one place for the page and the announcements.
 */
export function seatBandName(ride: Ride, row: SeatRow): string {
  const stops = ride.stops;
  const runs: string[] = [];
  let start = 0;
  let current = row.legs[0];
  for (let leg = 1; leg <= row.legs.length; leg++) {
    const status = leg < row.legs.length ? row.legs[leg] : null;
    if (status !== current) {
      runs.push(`${current === 'taken' ? 'taken' : 'free'} from ${stops[start].city} to ${stops[leg].city}`);
      start = leg;
      current = status ?? current;
    }
  }
  return `Seat ${row.seat}: ${runs.join(', ')}`;
}
