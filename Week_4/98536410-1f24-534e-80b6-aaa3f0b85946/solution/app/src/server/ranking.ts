// Nearest-shop ranking: great-circle distance, rounded half-up to 10 metres, with the published tie-breaks.

const EARTH_RADIUS_KM = 6371.0;

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = radians(lat1);
  const p2 = radians(lat2);
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(radians(lon2 - lon1) / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/** Rounds the shortest decimal form of `km` half-up to two decimals, so exact ties go up. */
function roundKm(km: number): number {
  const text = km.toString();
  if (text.includes("e")) return 0;
  const [whole = "0", fraction = ""] = text.split(".");
  const digits = `${fraction}000`.slice(0, 3);
  const cents = Number(whole) * 100 + Number(digits.slice(0, 2)) + (Number(digits[2]) >= 5 ? 1 : 0);
  return cents / 100;
}

interface Rankable {
  id: string;
  lat: number;
  lon: number;
  onHand: number;
}

interface Ranked<T extends Rankable> {
  shop: T;
  distanceKm: number;
}

/** Nearest first; ties go to more units on hand, then to the lower shop code. */
export function rankByDistance<T extends Rankable>(shops: T[], lat: number, lon: number): Ranked<T>[] {
  return shops
    .map((shop) => ({ shop, distanceKm: roundKm(haversineKm(lat, lon, shop.lat, shop.lon)) }))
    .sort((a, b) => a.distanceKm - b.distanceKm || b.shop.onHand - a.shop.onHand || (a.shop.id < b.shop.id ? -1 : 1));
}
