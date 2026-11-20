type LegStatus = "free" | "taken";

export interface SeatRow {
  seat: number;
  legs: LegStatus[];
}

/** Seat numbers that are free on every leg in [fromLeg, toLeg), lowest first. The one seat-freedom rule. */
export function freeSeats(seatMap: readonly SeatRow[], fromLeg: number, toLeg: number): number[] {
  return seatMap
    .filter((row) => row.legs.slice(fromLeg, toLeg).every((leg) => leg === "free"))
    .map((row) => row.seat)
    .sort((a, b) => a - b);
}

/** The seats a booking of `count` seats would take: the lowest-numbered free ones, or null when too few are free. */
export function assignSeats(seatMap: readonly SeatRow[], fromLeg: number, toLeg: number, count: number): number[] | null {
  const free = freeSeats(seatMap, fromLeg, toLeg);
  return free.length >= count ? free.slice(0, count) : null;
}

/** `Seat 1: taken from Kestrevel to Brisanne, free from Brisanne to Tollemarch` */
export function seatBandName(row: SeatRow, cities: readonly string[]): string {
  const runs: string[] = [];
  let start = 0;
  for (let i = 1; i <= row.legs.length; i += 1) {
    if (i === row.legs.length || row.legs[i] !== row.legs[start]) {
      runs.push(`${row.legs[start]} from ${cities[start]} to ${cities[i]}`);
      start = i;
    }
  }
  return `Seat ${row.seat}: ${runs.join(", ")}`;
}
