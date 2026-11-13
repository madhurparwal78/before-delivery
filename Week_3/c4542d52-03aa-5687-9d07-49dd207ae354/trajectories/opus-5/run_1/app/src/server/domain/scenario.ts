import type { ScenarioResult } from "../../shared/types.js";
import {
  ceilDiv,
  formatCents,
  formatPercent,
  formatPrice,
  percentHundredths,
  ratioHundredths,
  roundHalfUp,
} from "./money.js";

export interface ScenarioInput {
  preMoneyCents: bigint;
  investmentCents: bigint;
  targetPoolHundredths: bigint;
  fullyDilutedBefore: number;
  unallocatedPoolBefore: number;
  fmvPerShare: bigint | null;
}

export const TARGET_POOL_UNREACHABLE = "target_pool_unreachable";

/**
 * The round scenario arithmetic, in exact rational terms. Returns the unreachable
 * marker when the target pool cannot be reached at this investment (k >= 1).
 */
export function computeRoundScenario(input: ScenarioInput): ScenarioResult | typeof TARGET_POOL_UNREACHABLE {
  const fullyDiluted = BigInt(input.fullyDilutedBefore);
  const unallocated = BigInt(input.unallocatedPoolBefore);
  const kNumerator = input.targetPoolHundredths * (input.preMoneyCents + input.investmentCents);
  const kDenominator = 10000n * input.preMoneyCents;
  if (kNumerator >= kDenominator) return TARGET_POOL_UNREACHABLE;

  const topUpNumerator = kNumerator * fullyDiluted - unallocated * kDenominator;
  const topUpDenominator = kDenominator - kNumerator;
  const rawTopUp = ceilDiv(topUpNumerator, topUpDenominator);
  const poolTopUp = rawTopUp > 0n ? rawTopUp : 0n;

  const sharesBeforeRound = fullyDiluted + poolTopUp;
  const pricePerShare = (input.preMoneyCents * 100n) / sharesBeforeRound;
  const newShares = pricePerShare === 0n ? 0n : (input.investmentCents * 100n) / pricePerShare;
  const fullyDilutedAfter = sharesBeforeRound + newShares;

  return {
    fully_diluted_before: input.fullyDilutedBefore,
    unallocated_pool_before: input.unallocatedPoolBefore,
    pool_top_up: Number(poolTopUp),
    price_per_share: formatPrice(pricePerShare),
    new_shares: Number(newShares),
    fully_diluted_after: Number(fullyDilutedAfter),
    new_investor_percent: formatPercent(percentHundredths(newShares, fullyDilutedAfter)),
    pool_after_percent: formatPercent(percentHundredths(unallocated + poolTopUp, fullyDilutedAfter)),
    dilution_percent: formatPercent(percentHundredths(poolTopUp + newShares, fullyDilutedAfter)),
    investment_used: formatCents(roundHalfUp(newShares * pricePerShare, 100n)),
    fmv_per_share: input.fmvPerShare === null ? null : formatPrice(input.fmvPerShare),
    price_to_fmv:
      input.fmvPerShare === null || input.fmvPerShare === 0n
        ? null
        : formatPercent(ratioHundredths(pricePerShare, input.fmvPerShare)),
  };
}
