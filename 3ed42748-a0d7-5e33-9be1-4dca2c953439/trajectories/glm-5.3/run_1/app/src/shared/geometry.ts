// Bramble's geometry: the one home of arc and bearing maths (used by server and client).
export const PLANET_RADIUS_M = 60;
export const DOOR_DISTANCE_M = 4.0;
export const WALK_SPEED_MPS = 4;
export const TURN_RATE_DEG = 120; // a third of a full turn per second

export type LatLon = { lat: number; lon: number };

const DEG = Math.PI / 180;

export function toVec3(p: LatLon, r = PLANET_RADIUS_M): [number, number, number] {
  const lat = p.lat * DEG;
  const lon = p.lon * DEG;
  return [r * Math.cos(lat) * Math.cos(lon), r * Math.cos(lat) * Math.sin(lon), r * Math.sin(lat)];
}

export function toLatLon(v: readonly [number, number, number]): LatLon {
  const r = Math.hypot(v[0], v[1], v[2]);
  return { lat: Math.asin(v[2] / r) / DEG, lon: Math.atan2(v[1], v[0]) / DEG };
}

/** Central angle between two points, in radians. */
export function centralAngleRad(a: LatLon, b: LatLon): number {
  const [x1, y1, z1] = toVec3(a);
  const [x2, y2, z2] = toVec3(b, 1);
  const dot = x1 * x2 + y1 * y2 + z1 * z2;
  const cross = Math.hypot(y1 * z2 - z1 * y2, z1 * x2 - x1 * z2, x1 * y2 - y1 * x2);
  return Math.atan2(cross, dot);
}

/** Shortest distance over the surface between two positions, in metres. */
export function arcM(a: LatLon, b: LatLon, radius = PLANET_RADIUS_M): number {
  return centralAngleRad(a, b) * radius;
}

/** Compass direction at the start of the shortest path, clockwise from north, whole degrees 0..359. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const φ1 = a.lat * DEG;
  const φ2 = b.lat * DEG;
  const Δλ = (b.lon - a.lon) * DEG;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

export function compassLabel(bearing: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.floor(((bearing + 22.5) % 360) / 45)];
}

export function normalizeLatLon(p: LatLon): LatLon {
  let lat = ((p.lat + 90) % 360) - 90;
  if (lat < -90) lat += 360;
  let lon = ((p.lon + 180) % 360) - 180;
  if (lon < -180) lon += 360;
  return { lat, lon };
}

/** Steps from a along the great circle toward b by arc distance d (metres), on the sphere of radius r. */
export function stepToward(a: LatLon, b: LatLon, d: number, radius = PLANET_RADIUS_M): LatLon {
  const θ = centralAngleRad(a, b);
  if (θ === 0) return { ...a };
  const δ = Math.min(d / radius, θ);
  // Spherical interpolation in unit-vector form: the one home of this rule.
  const A = Math.sin(Math.max(0, θ - δ)) / Math.sin(θ);
  const B = Math.sin(δ) / Math.sin(θ);
  const [x1, y1, z1] = toVec3(a, 1);
  const [x2, y2, z2] = toVec3(b, 1);
  const x = A * x1 + B * x2;
  const y = A * y1 + B * y2;
  const z = A * z1 + B * z2;
  return { lat: Math.asin(z) / DEG, lon: Math.atan2(y, x) / DEG };
}

/** Points along the shortest path from a to b, n samples inclusive of both ends. */
export function pathPoints(a: LatLon, b: LatLon, n: number, radius = PLANET_RADIUS_M): LatLon[] {
  const total = arcM(a, b, radius);
  const out: LatLon[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    if (t >= 1) out.push({ ...b });
    else out.push(stepToward(a, b, total * t, radius));
  }
  return out;
}
