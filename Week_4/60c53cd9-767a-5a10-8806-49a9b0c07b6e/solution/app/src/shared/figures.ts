/** Derived area and price figures. Each rounds half up from integer inputs and is never stored. */

const SQFT_NUMERATOR = 107_639;
const SQFT_DENOMINATOR = 10_000;

const roundHalfUp = (numerator: number, denominator: number): number =>
  Math.floor((2 * numerator + denominator) / (2 * denominator));

export const areaSqftOf = (areaM2: number): number => roundHalfUp(areaM2 * SQFT_NUMERATOR, SQFT_DENOMINATOR);

export const pricePerM2Of = (price: number, areaM2: number): number => roundHalfUp(price, areaM2);

export const pricePerSqftOf = (price: number, areaM2: number): number => roundHalfUp(price, areaSqftOf(areaM2));

/** Whole dollars with thousands commas and no cents, e.g. `1,636,000`. */
export const formatDollars = (price: number): string => price.toLocaleString("en-US", { maximumFractionDigits: 0 });

/** The whole-dollar range a coordinator may price a unit within. */
export const PRICE_MIN = 100_000;
export const PRICE_MAX = 20_000_000;
