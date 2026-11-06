// Exact amounts and money (adapted from kit/modules/money): BigInt only, never binary floating point.

export const ASSET_DECIMALS = { BTC: 8, ETH: 18, USDC: 6, SOL: 9 } as const;
export type Asset = keyof typeof ASSET_DECIMALS;

export function isAsset(value: unknown): value is Asset {
  return typeof value === "string" && Object.hasOwn(ASSET_DECIMALS, value);
}

/** num/den rounded half up (all values here are non-negative). */
function roundHalfUp(num: bigint, den: bigint): bigint {
  const quotient = num / den;
  return (num % den) * 2n >= den ? quotient + 1n : quotient;
}

/** "0.3" for ETH → 300000000000000000n atomic units, or null when it is not a valid positive amount. */
export function parseAmount(asset: Asset, text: string): bigint | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const decimals = ASSET_DECIMALS[asset];
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return null;
  const atomic = BigInt(match[1] + fraction.padEnd(decimals, "0"));
  return atomic > 0n ? atomic : null;
}

/** 300000000000000000n ETH → "0.300000000000000000": always the asset's exact decimals. */
export function amountText(asset: Asset, atomic: bigint): string {
  const decimals = ASSET_DECIMALS[asset];
  const digits = atomic.toString().padStart(decimals + 1, "0");
  return `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
}

/** Fiat value: amount × rate (cents per whole unit), exact, rounded half up to a whole cent. */
export function fiatValueCents(asset: Asset, atomic: bigint, rateCents: bigint): bigint {
  return roundHalfUp(atomic * rateCents, 10n ** BigInt(ASSET_DECIMALS[asset]));
}

interface Tier {
  tier: number;
  label: string;
  first: number;
  last: number | null;
}

const TIERS: Tier[] = [
  { tier: 1, label: "Tier 1: first 100 messages", first: 1, last: 100 },
  { tier: 2, label: "Tier 2: messages 101 to 1,000", first: 101, last: 1000 },
  { tier: 3, label: "Tier 3: messages over 1,000", first: 1001, last: null },
];

/** Unit prices per tier, in ten-thousandths of the workspace currency. */
const TIER_PRICES: Record<string, [bigint, bigint, bigint]> = {
  EUR: [4250n, 2125n, 1375n],
  SGD: [6250n, 3125n, 2050n],
};

export interface FeeLine {
  tier: number;
  label: string;
  count: number;
  unitPrice: string;
  amountCents: bigint;
}

/** Messages counted in order into the tiers; each line is count × unit price rounded half up to cents. */
export function feeLines(currency: string, messageCount: number): FeeLine[] {
  const prices = TIER_PRICES[currency];
  return TIERS.flatMap((tier, i) => {
    const upper = tier.last === null ? messageCount : Math.min(messageCount, tier.last);
    const count = Math.max(0, upper - tier.first + 1);
    if (count === 0) return [];
    const price = prices[i];
    return [{
      tier: tier.tier,
      label: tier.label,
      count,
      unitPrice: `${price / 10000n}.${(price % 10000n).toString().padStart(4, "0")}`,
      amountCents: roundHalfUp(BigInt(count) * price, 100n),
    }];
  });
}
