import { roundHalfUp50 } from "../../shared/money";
import { config } from "../config";

interface RecommendedRange {
  lowCents: number;
  highCents: number;
}

/** The one recommended-range rule: route km × per-km bounds, each rounded half up to 50 cents. */
export function priceRange(routeKm: number): RecommendedRange {
  return {
    lowCents: roundHalfUp50(routeKm * config.priceMinPerKmCents),
    highCents: roundHalfUp50(routeKm * config.priceMaxPerKmCents),
  };
}

export function priceInRange(priceCents: number, range: RecommendedRange): boolean {
  return priceCents % 50 === 0 && priceCents >= range.lowCents && priceCents <= range.highCents;
}
