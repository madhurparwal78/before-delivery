// Largest-remainder trip split in whole cents (brief: Business rules, Trip-fee split).

/** Shares in ascending booking number order: the floor of fee ÷ count each, leftover cents to the lowest numbers. */
export function tripShares(feeCents: number, count: number): number[] {
  if (count === 0) return [];
  const base = Math.floor(feeCents / count);
  const leftover = feeCents - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < leftover ? 1 : 0));
}

export interface CountingShare {
  bookingId: string;
  shareCents: number;
  /** The share is billed once the booking's visit has left `open`. */
  billed: boolean;
}

/**
 * The excuse pool rule (brief: Business rules, Excusing a horse): billed shares stay, the excused share becomes 0,
 * and the pool (fee less the billed shares) is split over the open recipients in the given ascending booking
 * order, the floor each and leftover cents to the lowest numbers. Returns each booking's new share, or null when
 * the excused share is above 0 and nobody can take it (no_share_recipient). An excused share of 0 changes nothing.
 */
export function excuseShares(feeCents: number, others: readonly CountingShare[], excused: CountingShare): Map<string, number> | null {
  const next = new Map<string, number>([[excused.bookingId, excused.shareCents], ...others.map((s): [string, number] => [s.bookingId, s.shareCents])]);
  if (excused.shareCents === 0) return next;
  const recipients = others.filter((s) => !s.billed);
  if (!recipients.length) return null;
  const billed = others.filter((s) => s.billed).reduce((sum, s) => sum + s.shareCents, 0);
  next.set(excused.bookingId, 0);
  const pool = tripShares(feeCents - billed, recipients.length);
  recipients.forEach((s, index) => next.set(s.bookingId, pool[index] ?? 0));
  return next;
}
