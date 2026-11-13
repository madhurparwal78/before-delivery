import type { Role } from './types.js';

export interface Assets {
  QUSD: AssetSpec;
  MBTC: AssetSpec;
  METH: AssetSpec;
}

export interface AssetSpec {
  code: 'QUSD' | 'MBTC' | 'METH';
  name: string;
  decimals: number;
  seedPrice: bigint;
  poolSeedSupply: bigint;
  poolSeedHolder: string;
}

export const ASSETS: Assets = {
  QUSD: {
    code: 'QUSD', name: 'Quill Dollar', decimals: 6, seedPrice: 100_000_000n,
    poolSeedSupply: 2_000_000_000_000n, poolSeedHolder: 'lp-rosa',
  },
  MBTC: {
    code: 'MBTC', name: 'Moor Bitcoin', decimals: 8, seedPrice: 6_400_000_000_000n,
    poolSeedSupply: 4_000_000_000n, poolSeedHolder: 'lp-rosa',
  },
  METH: {
    code: 'METH', name: 'Moor Ether', decimals: 18, seedPrice: 320_000_000_000n,
    poolSeedSupply: 600_000_000_000_000_000_000n, poolSeedHolder: 'lp-tomas',
  },
};

export const ASSET_CODES: Array<'QUSD' | 'MBTC' | 'METH'> = ['QUSD', 'MBTC', 'METH'];

export function isAssetCode(value: string): value is 'QUSD' | 'MBTC' | 'METH' {
  return value === 'QUSD' || value === 'MBTC' || value === 'METH';
}

export interface PoolParams {
  ltv_bps: number;
  liquidation_threshold_bps: number;
  liquidation_bonus_bps: number;
  reserve_factor_bps: number;
  close_factor_bps: number;
  swap_fee_bps: number;
  warning_health_factor: string;
}

export interface CurveSpec {
  base_bps: number;
  slope1_bps: number;
  kink_bps: number;
  slope2_bps: number;
}

export const SEED_PARAMS: Record<'QUSD' | 'MBTC' | 'METH', PoolParams> = {
  QUSD: { ltv_bps: 8000, liquidation_threshold_bps: 8500, liquidation_bonus_bps: 400, reserve_factor_bps: 1000, close_factor_bps: 5000, swap_fee_bps: 30, warning_health_factor: '1.1000' },
  MBTC: { ltv_bps: 7000, liquidation_threshold_bps: 7500, liquidation_bonus_bps: 500, reserve_factor_bps: 1000, close_factor_bps: 5000, swap_fee_bps: 30, warning_health_factor: '1.1000' },
  METH: { ltv_bps: 7500, liquidation_threshold_bps: 8000, liquidation_bonus_bps: 500, reserve_factor_bps: 1500, close_factor_bps: 5000, swap_fee_bps: 30, warning_health_factor: '1.1000' },
};

export const SEED_CURVES: Record<'QUSD' | 'MBTC' | 'METH', CurveSpec> = {
  QUSD: { base_bps: 0, slope1_bps: 400, kink_bps: 9000, slope2_bps: 6000 },
  MBTC: { base_bps: 0, slope1_bps: 400, kink_bps: 4500, slope2_bps: 30000 },
  METH: { base_bps: 0, slope1_bps: 300, kink_bps: 8000, slope2_bps: 8000 },
};

export const ROLE_LABELS: Record<Role, string> = {
  risk_steward: 'Risk steward',
  liquidity_provider: 'Liquidity provider',
  borrower: 'Borrower',
  trader: 'Trader',
  liquidator: 'Liquidator',
};
