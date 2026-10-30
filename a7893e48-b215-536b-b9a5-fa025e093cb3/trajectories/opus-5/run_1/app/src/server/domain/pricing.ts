import type { HoldQuote } from '../../shared/types.js';

export const QUARTER_HOUR = 15;

/** Exact because every station rate is divisible by four cents. */
export function timeCents(minutes: number, rateCents: number): number {
  return (minutes * rateCents) / 60;
}

export function overrunCents(minutes: number, rateCents: number): number {
  return Math.floor((minutes * rateCents) / 60 + 0.5);
}

export interface PackShare {
  packMinutes: number;
  cardMinutes: number;
}

/**
 * Pack hours cover occurrences in time order, in whole quarter hours, out of
 * the balance the server holds now.
 */
export function splitPackCover(availableMinutes: number, occurrenceMinutes: readonly number[]): PackShare[] {
  let remaining = availableMinutes;
  return occurrenceMinutes.map((minutes) => {
    const coverable = Math.min(remaining, minutes);
    const packMinutes = Math.max(0, Math.floor(coverable / QUARTER_HOUR) * QUARTER_HOUR);
    remaining -= packMinutes;
    return { packMinutes, cardMinutes: minutes - packMinutes };
  });
}

/** A hold's quote covers all of its occurrences together, as if use_pack were true. */
export function quoteFor(
  availableMinutes: number,
  occurrenceMinutes: readonly number[],
  rateCents: number,
  siteDepositCents: number,
): HoldQuote {
  const shares = splitPackCover(availableMinutes, occurrenceMinutes);
  const packMinutes = shares.reduce((sum, share) => sum + share.packMinutes, 0);
  const cardMinutes = shares.reduce((sum, share) => sum + share.cardMinutes, 0);
  const depositing = shares.filter((share) => share.cardMinutes > 0).length;
  return {
    pack_minutes_available: availableMinutes,
    pack_minutes: packMinutes,
    card_minutes: cardMinutes,
    card_cents: timeCents(cardMinutes, rateCents),
    deposit_cents: siteDepositCents * depositing,
  };
}
