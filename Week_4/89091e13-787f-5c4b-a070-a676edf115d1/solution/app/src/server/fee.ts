import { config } from "./config.ts";
import { SHARE_SIZE } from "../shared/share.ts";
import { sharesForBytes } from "./square.ts";
import type { FeeEstimate } from "../shared/api.ts";

const BLOB_GAS_BASE = 65_000;
const GAS_PER_SHARE_BYTE = 8;
/** Staking and governance transactions use 80,000 gas. */
export const STAKING_GAS = 80_000;

/** Fee in ufern = ceil(gas x MIN_GAS_PRICE), exact. */
function feeForGas(gas: number): number {
  const { numerator, denominator } = config.minGasPrice;
  return Number((BigInt(gas) * numerator + denominator - 1n) / denominator);
}

export function estimateBlob(size: number): FeeEstimate {
  const shares = sharesForBytes(size);
  const gas = BLOB_GAS_BASE + shares * SHARE_SIZE * GAS_PER_SHARE_BYTE;
  return { size, shares, gas, feeUfern: feeForGas(gas) };
}

export const stakingFee = () => feeForGas(STAKING_GAS);
