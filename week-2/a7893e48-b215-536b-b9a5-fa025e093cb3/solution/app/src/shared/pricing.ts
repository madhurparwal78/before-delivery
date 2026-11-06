/** Pricing and pack rules, shared so the live sweep quote and the server's charge are one formula. */

export const QUARTER_MINUTES = 15;

/** card minutes × hourly rate ÷ 60; exact because every rate is divisible by four cents. */
export function timeCents(minutes: number, rateCents: number): number {
  return (minutes * rateCents) / 60;
}

/** Overrun price, rounded half-up to the cent. */
export function overrunCents(minutes: number, rateCents: number): number {
  return Math.floor((2 * minutes * rateCents + 60) / 120);
}

/**
 * Pack share per occurrence: the available balance covers occurrences in time order in whole
 * quarter hours; the rest is card time.
 */
export function packSplit(minutesInTimeOrder: number[], availableMinutes: number): number[] {
  let remaining = Math.max(0, availableMinutes);
  return minutesInTimeOrder.map((minutes) => {
    const share = Math.min(minutes, Math.floor(remaining / QUARTER_MINUTES) * QUARTER_MINUTES);
    remaining -= share;
    return share;
  });
}

export const PACK_PRODUCT = { id: "20h", minutes: 1200, priceCents: 56000 } as const;

/** Half-open station time: [a0, a1) and [b0, b1) overlap; touching ends do not. */
export function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1;
}
