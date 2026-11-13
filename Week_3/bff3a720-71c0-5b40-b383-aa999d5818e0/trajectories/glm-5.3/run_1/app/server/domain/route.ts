import type { Config } from './config.js';
import { distanceKm } from './cities.js';

/**
 * Ride geometry, stop times, price range and segment price — one place for each rule.
 */

export interface StopSpec { city: string; km: number; time: number }

export function legKm(from: string, to: string): number | null {
  return distanceKm(from, to);
}

export interface RouteSpec {
  stops: StopSpec[];
  routeKm: number;
}

/** Builds stop positions and times from a city list. Returns null for any unknown gap. */
export function buildRoute(cities: string[], departureEpochMs: number, cfg: Config): RouteSpec | null {
  if (cities.length < 2) return null;
  const stops: StopSpec[] = [];
  let cum = 0;
  for (let i = 0; i < cities.length; i++) {
    if (i > 0) {
      const step = distanceKm(cities[i - 1], cities[i]);
      if (step === null || step === 0) return null;
      cum += step;
    }
    const minutes = Math.ceil((cum * 60) / cfg.averageSpeedKmh);
    stops.push({ city: cities[i], km: cum, time: departureEpochMs + minutes * 60_000 });
  }
  return { stops, routeKm: cum };
}

/** Recommended range: km × per-km bounds, each rounded half up to the nearest 50 cents. */
export function priceRange(routeKm: number, cfg: Config): { lowCents: number; highCents: number } {
  return {
    lowCents: roundHalfUpTo50(routeKm * cfg.priceMinPerKmCents),
    highCents: roundHalfUpTo50(routeKm * cfg.priceMaxPerKmCents),
  };
}

export function roundHalfUpTo50(cents: number): number {
  return Math.round(cents / 50) * 50;
}

/** Whole-route price validity: multiple of 50 cents inside the range, ends allowed. */
export function wholePriceValid(priceCents: number, routeKm: number, cfg: Config): boolean {
  const { lowCents, highCents } = priceRange(routeKm, cfg);
  return priceCents % 50 === 0 && priceCents >= lowCents && priceCents <= highCents;
}

/** Segment price per seat: floor(whole price × segment km ÷ route km). */
export function segmentPrice(priceCents: number, segmentKm: number, routeKm: number): number {
  return Math.floor((priceCents * segmentKm) / routeKm);
}

/** Segment km between two stops of a route. */
export function segmentKm(spec: RouteSpec, boarding: string, alighting: string): number | null {
  const i = spec.stops.findIndex(s => s.city === boarding);
  const j = spec.stops.findIndex(s => s.city === alighting);
  if (i < 0 || j <= i) return null;
  return spec.stops[j].km - spec.stops[i].km;
}
