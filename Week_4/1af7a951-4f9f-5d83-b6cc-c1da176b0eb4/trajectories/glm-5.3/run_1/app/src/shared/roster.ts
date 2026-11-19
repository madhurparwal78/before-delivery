// Roster aggregates, decided here and reused by the roster endpoint and the
// digest.

export function recallRate(recalledNights: number, nightsElapsed: number): number {
  if (nightsElapsed <= 0) return 0;
  // two decimals, halves rounding up
  return Math.floor((recalledNights * 100) / nightsElapsed + 0.5 + 1e-9) / 100;
}
