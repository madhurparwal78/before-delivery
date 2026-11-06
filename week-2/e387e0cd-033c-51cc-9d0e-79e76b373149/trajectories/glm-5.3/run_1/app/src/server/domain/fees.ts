// Tier pricing: one place decides the fee lines for a message count.
export interface TierPrice { tier: number; label: string; unitPriceCents: bigint }

export const TIER_LABELS = {
  1: 'Tier 1: first 100 messages',
  2: 'Tier 2: messages 101 to 1,000',
  3: 'Tier 3: messages over 1,000',
} as const;

export const TIER_PRICES: Record<string, [bigint, bigint, bigint]> = {
  EUR: [4250n, 2125n, 1375n],
  SGD: [6250n, 3125n, 2050n],
};

export function tierPrices(currency: string): TierPrice[] {
  const prices = TIER_PRICES[currency] ?? [0n, 0n, 0n];
  return [1, 2, 3].map((tier) => ({ tier, label: TIER_LABELS[tier as 1 | 2 | 3], unitPriceCents: prices[tier - 1] }));
}

export interface FeeLine { tier: number; label: string; count: number; unitPrice: string; amountCents: number }

/** Rounding half up to whole cents per line, computed exactly. Unit prices are
 * carried as ten-thousandths of the currency, so a line amount is
 * count × price scaled to cents and rounded half up to the cent. */
export function feeLines(messageCount: number, currency: string): FeeLine[] {
  const prices = tierPrices(currency);
  const lines: FeeLine[] = [];
  for (const tier of prices) {
    let count = 0;
    if (tier.tier === 1) count = Math.min(messageCount, 100);
    if (tier.tier === 2) count = Math.min(Math.max(0, messageCount - 100), 900);
    if (tier.tier === 3) count = Math.max(0, messageCount - 1000);
    if (count === 0) continue;
    const exact = BigInt(count) * tier.unitPriceCents;
    const rounded = exact % 100n >= 50n ? exact / 100n + 1n : exact / 100n;
    lines.push({ tier: tier.tier, label: tier.label, count, unitPrice: unitPriceString(tier.unitPriceCents), amountCents: Number(rounded) });
  }
  return lines;
}

export function unitPriceString(priceCents: bigint): string {
  const digits = priceCents.toString().padStart(5, '0');
  return `${digits.slice(0, -4)}.${digits.slice(-4)}`;
}

export function feeTotal(lines: FeeLine[]): number {
  return lines.reduce((sum, line) => sum + line.amountCents, 0);
}
