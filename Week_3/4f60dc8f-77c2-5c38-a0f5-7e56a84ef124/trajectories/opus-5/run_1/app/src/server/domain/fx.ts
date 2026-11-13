import { RATE_SCALE, type CurrencyCode } from '../../shared/money.js';

export type RateRecord = { currency: CurrencyCode; rateE4: bigint; effectiveAt: Date; seq: bigint };

export const GBP_RATE_E4 = RATE_SCALE;

/**
 * The rate in effect at a moment: the latest `effective_at` not after it, and on a tie the
 * record created later.
 */
export const recordInEffect = (
  rates: readonly RateRecord[],
  currency: CurrencyCode,
  moment: Date,
): RateRecord | null => {
  let best: RateRecord | null = null;
  for (const rate of rates) {
    if (rate.currency !== currency) continue;
    if (rate.effectiveAt.getTime() > moment.getTime()) continue;
    if (
      best === null ||
      rate.effectiveAt.getTime() > best.effectiveAt.getTime() ||
      (rate.effectiveAt.getTime() === best.effectiveAt.getTime() && rate.seq > best.seq)
    )
      best = rate;
  }
  return best;
};

/** GBP always prices at 1.0000. */
export const rateInEffect = (
  rates: readonly RateRecord[],
  currency: CurrencyCode,
  moment: Date,
): bigint =>
  currency === 'GBP' ? GBP_RATE_E4 : (recordInEffect(rates, currency, moment)?.rateE4 ?? GBP_RATE_E4);
