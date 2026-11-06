// Indexed-time formula and time formatting, decided here and only here.
import { Decimal } from "decimal.js";

Decimal.set({ precision: 34 });

export const P2P = new Decimal("2");
export const P3 = new Decimal("0.001");
export const P4 = new Decimal("0.0001");

/** Three-decimal text for run times, as the API publishes them. */
export function fmtTime(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return new Decimal(value).toFixed(3, Decimal.ROUND_HALF_UP);
}

/** Four-decimal text for factors. */
export function fmtFactor(value: string | number): string {
  return new Decimal(value).toFixed(4, Decimal.ROUND_HALF_UP);
}

/** adjusted = raw + 2.000 x cones */
export function adjustedTime(raw: string, cones: number): string {
  return new Decimal(raw).plus(P2P.times(cones)).toFixed(3, Decimal.ROUND_HALF_UP);
}

/** indexed = round half up (adjusted x factor) to three decimals, exact decimal arithmetic. */
export function indexedTime(adjusted: string, factor: string): string {
  return new Decimal(adjusted).times(new Decimal(factor)).toFixed(3, Decimal.ROUND_HALF_UP);
}

/** Round half up to three decimals, used for season points. */
export function roundHalfUp3(value: Decimal): string {
  return value.toFixed(3, Decimal.ROUND_HALF_UP);
}

export function decimal(value: string | number | null | undefined): Decimal | null {
  if (value === null || value === undefined) return null;
  return new Decimal(value as string);
}

/** Season points: round half up of (100 x fastest / driver) to three decimals. */
export function seasonPoints(fastest: string, driverBest: string): string {
  return roundHalfUp3(new Decimal(100).times(new Decimal(fastest)).div(new Decimal(driverBest)));
}
