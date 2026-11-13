import { config } from '../config.js';
import { legKm, type City } from '../../shared/cities.js';
import { addMinutes } from './time.js';

export interface RouteStop {
  city: City;
  km: number;
}

export interface RouteLeg {
  index: number;
  from: City;
  to: City;
  km: number;
}

/** Cumulative km from the origin for each stop of a route. */
export function routeStops(cities: readonly City[]): RouteStop[] {
  const stops: RouteStop[] = [];
  let km = 0;
  cities.forEach((city, index) => {
    if (index > 0) km += legKm(cities[index - 1] as City, city);
    stops.push({ city, km });
  });
  return stops;
}

export function routeLegs(cities: readonly City[]): RouteLeg[] {
  const legs: RouteLeg[] = [];
  for (let i = 0; i + 1 < cities.length; i += 1) {
    const from = cities[i] as City;
    const to = cities[i + 1] as City;
    legs.push({ index: i, from, to, km: legKm(from, to) });
  }
  return legs;
}

export function routeKm(cities: readonly City[]): number {
  return routeLegs(cities).reduce((total, leg) => total + leg.km, 0);
}

/** Minutes from departure to a stop: ceil(cumulative km × 60 ÷ average speed). */
export function minutesToKm(km: number): number {
  return Math.ceil((km * 60) / config.limits.averageSpeedKmh);
}

export function stopTime(departure: Date, km: number): Date {
  return addMinutes(departure, minutesToKm(km));
}

export function segmentKm(stops: readonly RouteStop[], boarding: number, alighting: number): number {
  const to = stops[alighting];
  const from = stops[boarding];
  if (!to || !from) throw new Error('Segment outside the route');
  return to.km - from.km;
}
