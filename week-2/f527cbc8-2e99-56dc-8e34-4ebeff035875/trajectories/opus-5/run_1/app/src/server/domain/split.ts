/**
 * The trip-fee split and the excuse pool rule. Shares are whole cents that always add
 * up exactly to the day's fee, with leftover cents placed by largest remainder; shares
 * are equal so every remainder ties, and ties go to the lower booking number first.
 */

export interface ShareCandidate {
  bookingId: string;
  number: number;
}

export interface ShareResult {
  bookingId: string;
  shareCents: number;
}

/** Splits an amount over candidates in ascending booking number. */
export function splitEvenly(amountCents: number, candidates: readonly ShareCandidate[]): ShareResult[] {
  const ordered = [...candidates].sort((left, right) => left.number - right.number);
  if (ordered.length === 0) return [];
  const base = Math.floor(amountCents / ordered.length);
  const leftover = amountCents - base * ordered.length;
  return ordered.map((candidate, index) => ({
    bookingId: candidate.bookingId,
    shareCents: base + (index < leftover ? 1 : 0),
  }));
}

/** The shares fixed when a barn day starts. */
export function initialShares(tripFeeCents: number, counting: readonly ShareCandidate[]): ShareResult[] {
  return splitEvenly(tripFeeCents, counting);
}

export interface ExcusePoolInput {
  tripFeeCents: number;
  /** The booking being excused, with the share it carries now. */
  excused: ShareCandidate & { shareCents: number };
  /** Counting bookings whose share is already billed; these never change. */
  billed: readonly (ShareCandidate & { shareCents: number })[];
  /** Counting bookings not yet billed, which take the pool. */
  openRecipients: readonly (ShareCandidate & { shareCents: number })[];
}

export type ExcusePoolOutcome =
  | { kind: 'no_change' }
  | { kind: 'no_share_recipient' }
  | { kind: 'adjusted'; shares: ShareResult[] };

/**
 * Excusing a horse moves its share only onto counting horses not yet billed: billed
 * shares stay as they are, the excused share becomes 0, and the remaining pool is
 * split over the open recipients in ascending booking number.
 */
export function excusePool(input: ExcusePoolInput): ExcusePoolOutcome {
  if (input.excused.shareCents === 0) return { kind: 'no_change' };
  if (input.openRecipients.length === 0) return { kind: 'no_share_recipient' };

  const billedTotal = input.billed.reduce((sum, entry) => sum + entry.shareCents, 0);
  const pool = input.tripFeeCents - billedTotal;
  const shares = splitEvenly(pool, input.openRecipients);
  shares.push({ bookingId: input.excused.bookingId, shareCents: 0 });
  return { kind: 'adjusted', shares };
}
