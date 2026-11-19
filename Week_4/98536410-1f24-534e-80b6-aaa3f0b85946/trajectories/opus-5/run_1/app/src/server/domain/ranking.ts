const EARTH_RADIUS_KM = 6371.0;

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance by the haversine formula, rounded half-up to 0.01 km. */
export function distanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  const exact = 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
  return Math.round(exact * 100 + Number.EPSILON * exact * 100) / 100;
}

export type Rankable = { storeId: string; distanceKm: number; onHandForTieBreak: number };

/** Nearest first, then more units on hand, then store code ascending. */
export function rankByDistance<T extends Rankable>(shops: T[]): T[] {
  return [...shops].sort(
    (a, b) =>
      a.distanceKm - b.distanceKm ||
      b.onHandForTieBreak - a.onHandForTieBreak ||
      (a.storeId < b.storeId ? -1 : a.storeId > b.storeId ? 1 : 0),
  );
}

