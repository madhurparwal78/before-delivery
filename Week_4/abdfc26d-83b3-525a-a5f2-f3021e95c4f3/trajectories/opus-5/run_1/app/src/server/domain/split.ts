export type SplitParty = 'creator' | 'remixer' | 'platform';

/** Leftover cents break ties in this order. */
const TIE_ORDER: readonly SplitParty[] = ['creator', 'remixer', 'platform'];

export const PLATFORM_HOLDER_NAME = 'Brightmoss Works';

const PLATFORM_FEE_PERCENT = 10;
const REMIX_ROYALTY_PERCENT = 15;

export interface PartyAmount {
  readonly party: SplitParty;
  readonly amountCents: number;
}

interface Weight {
  readonly party: SplitParty;
  /** Exact share numerator over the shared denominator; never a float. */
  readonly numerator: number;
}

/**
 * Floors each share, then hands the leftover cents one each to the largest
 * fractional remainders, breaking ties creator, then remixer, then platform.
 */
function allocate(weights: readonly Weight[], denominator: number, total: number): PartyAmount[] {
  const floored = weights.map((weight) => ({
    party: weight.party,
    amountCents: Math.floor(weight.numerator / denominator),
    remainder: weight.numerator % denominator,
  }));

  let leftover = total - floored.reduce((sum, share) => sum + share.amountCents, 0);

  const byRemainder = [...floored].sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder;
    return TIE_ORDER.indexOf(a.party) - TIE_ORDER.indexOf(b.party);
  });

  for (const share of byRemainder) {
    if (leftover <= 0) break;
    share.amountCents += 1;
    leftover -= 1;
  }

  return floored.map((share) => ({ party: share.party, amountCents: share.amountCents }));
}

/**
 * Splits a sale's net price. The platform fee is exactly 10% of net; on a remix
 * sale the original creator's royalty is exactly 15% and the remixer takes the rest.
 */
export function allocateSaleSplit(netCents: number, isRemix: boolean): PartyAmount[] {
  const weights: Weight[] = isRemix
    ? [
        { party: 'creator', numerator: netCents * REMIX_ROYALTY_PERCENT },
        {
          party: 'remixer',
          numerator: netCents * (100 - REMIX_ROYALTY_PERCENT - PLATFORM_FEE_PERCENT),
        },
        { party: 'platform', numerator: netCents * PLATFORM_FEE_PERCENT },
      ]
    : [
        { party: 'creator', numerator: netCents * (100 - PLATFORM_FEE_PERCENT) },
        { party: 'platform', numerator: netCents * PLATFORM_FEE_PERCENT },
      ];

  return allocate(weights, 100, netCents);
}

export interface PartySaleRow {
  readonly party: SplitParty;
  /** The party's original sale row, in cents. */
  readonly saleCents: number;
  /** Cents of that row already reversed by earlier refunds, as a positive number. */
  readonly reversedCents: number;
}

/**
 * Splits a refunded net across the order's parties in proportion to their sale
 * rows. The refund that reaches the full net returns each party's remaining
 * amount exactly. Returned amounts are positive; callers write them negated.
 */
export function allocateRefundReversal(
  originalNetCents: number,
  rows: readonly PartySaleRow[],
  refundNetCents: number,
  alreadyRefundedNetCents: number,
): PartyAmount[] {
  if (alreadyRefundedNetCents + refundNetCents === originalNetCents) {
    return rows.map((row) => ({
      party: row.party,
      amountCents: row.saleCents - row.reversedCents,
    }));
  }

  const weights = rows.map((row) => ({
    party: row.party,
    numerator: refundNetCents * row.saleCents,
  }));

  return allocate(weights, originalNetCents, refundNetCents);
}
