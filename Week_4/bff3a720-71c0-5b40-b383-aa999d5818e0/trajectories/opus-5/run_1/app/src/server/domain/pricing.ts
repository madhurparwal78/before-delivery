import { config } from '../config.js';

const STEP_CENTS = 50;

/** Round to the nearest 50 cents, halves going up. */
export function roundToStep(cents: number): number {
  return Math.floor(cents / STEP_CENTS + 0.5) * STEP_CENTS;
}

export interface PriceRange {
  routeKm: number;
  lowCents: number;
  highCents: number;
}

export function priceRange(km: number): PriceRange {
  return {
    routeKm: km,
    lowCents: roundToStep(km * config.limits.priceMinPerKmCents),
    highCents: roundToStep(km * config.limits.priceMaxPerKmCents),
  };
}

export function priceIsAllowed(priceCents: number, km: number): boolean {
  const range = priceRange(km);
  return (
    priceCents % STEP_CENTS === 0 &&
    priceCents >= range.lowCents &&
    priceCents <= range.highCents
  );
}

/** The middle of the recommended range, rounded half up to 50 cents. */
export function middleOfRange(km: number): number {
  const range = priceRange(km);
  return roundToStep((range.lowCents + range.highCents) / 2);
}
