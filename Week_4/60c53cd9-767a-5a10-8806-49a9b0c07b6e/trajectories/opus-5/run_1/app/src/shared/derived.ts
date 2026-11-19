/** The one place that derives area and price figures, and the bearing's facing label. */

import type { Facing } from './units';

const SQFT_PER_M2_NUMERATOR = 107639;
const SQFT_PER_M2_DENOMINATOR = 10000;

/** Rounds a positive rational numerator/denominator half up, in integer arithmetic. */
function roundHalfUp(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new Error('derived figures need safe integers');
  }
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

export function areaSqft(areaM2: number): number {
  return roundHalfUp(areaM2 * SQFT_PER_M2_NUMERATOR, SQFT_PER_M2_DENOMINATOR);
}

export function pricePerM2(price: number, areaM2: number): number {
  return roundHalfUp(price, areaM2);
}

export function pricePerSqft(price: number, areaM2: number): number {
  return roundHalfUp(price, areaSqft(areaM2));
}

const FACINGS: readonly Facing[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** The eight-point label for a bearing, from 45 degree sectors centred on each point. */
export function facingForBearing(bearing: number): Facing {
  const normalised = ((bearing % 360) + 360) % 360;
  const sector = Math.floor(((normalised + 22.5) % 360) / 45);
  return FACINGS[sector];
}

/**
 * The compass bearing of a window direction in model space, in whole degrees.
 * North is the model's negative Z axis and east its positive X axis.
 */
export function bearingFromModelDirection(x: number, z: number): number {
  const degrees = (Math.atan2(x, -z) * 180) / Math.PI;
  return ((Math.round(degrees) % 360) + 360) % 360;
}

/** Whole dollars with thousands commas and no cents, for example 1,636,000. */
export function formatDollars(price: number): string {
  return price.toLocaleString('en-US', { useGrouping: true, maximumFractionDigits: 0 });
}
