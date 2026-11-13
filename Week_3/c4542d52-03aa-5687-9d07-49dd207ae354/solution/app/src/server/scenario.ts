import { PRICE_DECIMALS, formatPrice, formatScaled, parseDecimal, percentText, roundHalfUp } from "./decimal.js";

export type ScenarioInputs = { preMoneyCents: bigint; investmentCents: bigint; poolHundredths: bigint };
type ScenarioOutcome =
  | { ok: false; field: "pre_money" | "target_pool_percent" }
  | {
      ok: true;
      poolTopUp: number;
      pricePerShare: string;
      priceUnits: bigint;
      newShares: number;
      fullyDilutedAfter: number;
      newInvestorPercent: string;
      poolAfterPercent: string;
      dilutionPercent: string;
      investmentUsed: string;
    };

export const MAX_POOL_HUNDREDTHS = 3000n;

export function parseAmount(text: unknown): bigint | null {
  const cents = parseDecimal(text, 2);
  return cents !== null && cents > 0n ? cents : null;
}

export function parsePoolPercent(text: unknown): bigint | null {
  const hundredths = parseDecimal(text, 2);
  return hundredths !== null && hundredths <= MAX_POOL_HUNDREDTHS ? hundredths : null;
}

/** Round scenario arithmetic in exact integers; changes nothing in the register. */
export function roundScenario(inputs: ScenarioInputs, fullyDiluted: number, unallocated: number): ScenarioOutcome {
  const { preMoneyCents, investmentCents, poolHundredths } = inputs;
  const F = BigInt(fullyDiluted);
  const U = BigInt(unallocated);
  // k = p ÷ 100 × (pre-money + investment) ÷ pre-money, kept as kNumerator ÷ kDenominator.
  const kNumerator = poolHundredths * (preMoneyCents + investmentCents);
  const kDenominator = 10000n * preMoneyCents;
  if (kNumerator >= kDenominator) return { ok: false, field: "target_pool_percent" };
  const topUpNumerator = kNumerator * F - U * kDenominator;
  const topUpDenominator = kDenominator - kNumerator;
  const poolTopUp = topUpNumerator <= 0n ? 0n : (topUpNumerator + topUpDenominator - 1n) / topUpDenominator;
  const priceUnits = (preMoneyCents * 10n ** BigInt(PRICE_DECIMALS)) / (100n * (F + poolTopUp));
  if (priceUnits === 0n) return { ok: false, field: "pre_money" };
  const newShares = (investmentCents * 10n ** BigInt(PRICE_DECIMALS)) / (100n * priceUnits);
  const after = F + poolTopUp + newShares;
  return {
    ok: true,
    poolTopUp: Number(poolTopUp),
    pricePerShare: formatPrice(priceUnits),
    priceUnits,
    newShares: Number(newShares),
    fullyDilutedAfter: Number(after),
    newInvestorPercent: percentText(newShares, after),
    poolAfterPercent: percentText(U + poolTopUp, after),
    dilutionPercent: percentText(poolTopUp + newShares, after),
    investmentUsed: formatScaled(roundHalfUp(newShares * priceUnits, 100n), 2),
  };
}

/** price ÷ fair market value as a two-decimal ratio, halves rounded up. */
export function priceToFairMarketValue(priceUnits: bigint, fmvUnits: bigint): string {
  return formatScaled(roundHalfUp(priceUnits * 100n, fmvUnits), 2);
}
