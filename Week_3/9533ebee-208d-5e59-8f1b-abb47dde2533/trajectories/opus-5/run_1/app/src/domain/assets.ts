/** The three listed assets. Their identity and decimals are fixed. */

export const ASSET_CODES = ['QUSD', 'MBTC', 'METH'] as const;

export type Asset = (typeof ASSET_CODES)[number];

interface AssetIdentity {
  readonly name: string;
  readonly decimals: number;
}

const IDENTITY: Readonly<Record<Asset, AssetIdentity>> = {
  QUSD: { name: 'Quill Dollar', decimals: 6 },
  MBTC: { name: 'Moor Bitcoin', decimals: 8 },
  METH: { name: 'Moor Ether', decimals: 18 },
};

export function isAsset(value: unknown): value is Asset {
  return typeof value === 'string' && (ASSET_CODES as readonly string[]).includes(value);
}

export function assetName(asset: Asset): string {
  return IDENTITY[asset].name;
}

export function assetDecimals(asset: Asset): number {
  return IDENTITY[asset].decimals;
}

/** 10^decimals as a bigint scale, used throughout the money formulas. */
export function assetScale(asset: Asset): bigint {
  return 10n ** BigInt(IDENTITY[asset].decimals);
}

/** One price unit is one hundred-millionth of a dollar. */
export const PRICE_DECIMALS = 8;
export const PRICE_SCALE = 100000000n;

/** Health factors and basis points are scaled by 10,000. */
export const BPS = 10000n;

/** The cumulative borrow index is scaled by 10^27. */
export const INDEX_SCALE = 10n ** 27n;

/** Seconds in a year, as the interest formula states. */
export const SECONDS_PER_YEAR = 31536000n;
