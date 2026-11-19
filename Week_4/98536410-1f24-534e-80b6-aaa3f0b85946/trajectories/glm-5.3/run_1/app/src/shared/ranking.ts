const EARTH_RADIUS_KM = 6371.0;

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  const km = 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
  return Math.round(km * 100) / 100;
}
