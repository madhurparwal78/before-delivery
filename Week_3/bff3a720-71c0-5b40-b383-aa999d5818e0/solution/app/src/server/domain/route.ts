import { type City, legKm } from "../../shared/towns";
import { plusMinutes } from "../clock";
import { config } from "../config";

export interface RouteShape {
  cities: City[];
  /** km from the origin to each stop */
  cumulativeKm: number[];
  legKms: number[];
  routeKm: number;
  /** time at each stop */
  times: Date[];
}

/** Minutes from departure to a stop: ceil(cumulative km × 60 ÷ speed). */
function minutesAt(km: number): number {
  return Math.ceil((km * 60) / config.averageSpeedKmh);
}

/** Legs, cumulative km and stop times of a ride: the one place a route is measured. */
export function shapeRoute(cities: City[], departure: Date): RouteShape {
  const legKms = cities.slice(1).map((city, index) => legKm(cities[index] as City, city));
  const cumulativeKm = [0];
  for (const km of legKms) cumulativeKm.push((cumulativeKm[cumulativeKm.length - 1] ?? 0) + km);
  return {
    cities,
    cumulativeKm,
    legKms,
    routeKm: cumulativeKm[cumulativeKm.length - 1] ?? 0,
    times: cumulativeKm.map((km) => plusMinutes(departure, minutesAt(km))),
  };
}

export function segmentKm(route: RouteShape, boardingIndex: number, alightingIndex: number): number {
  return (route.cumulativeKm[alightingIndex] ?? 0) - (route.cumulativeKm[boardingIndex] ?? 0);
}

/** Arrival is the time at the last stop. */
export function arrivalOf(route: RouteShape): Date {
  return route.times[route.times.length - 1] as Date;
}
