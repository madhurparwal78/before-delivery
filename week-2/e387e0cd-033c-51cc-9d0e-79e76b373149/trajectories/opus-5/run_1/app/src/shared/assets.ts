import { formatScaled, parseScaled } from './decimal';

export const ASSETS = ['BTC', 'ETH', 'USDC', 'SOL'] as const;

export type Asset = (typeof ASSETS)[number];

const DECIMALS: Readonly<Record<Asset, number>> = {
  BTC: 8,
  ETH: 18,
  USDC: 6,
  SOL: 9,
};

export function isAsset(value: unknown): value is Asset {
  return typeof value === 'string' && (ASSETS as readonly string[]).includes(value);
}

export function assetDecimals(asset: Asset): number {
  return DECIMALS[asset];
}

/** Parses a crypto amount, which must be greater than zero. */
export function parseAmount(input: string, asset: Asset): bigint | null {
  const scaled = parseScaled(input, assetDecimals(asset));
  if (scaled === null || scaled <= 0n) return null;
  return scaled;
}

/** Renders a crypto amount with exactly the asset's decimals. */
export function formatAmount(scaled: bigint, asset: Asset): string {
  return formatScaled(scaled, assetDecimals(asset));
}
