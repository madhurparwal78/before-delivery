// WGS84 ellipsoid and geodesy helpers. All positions are float64 ECEF metres.
export const WGS84_A = 6378137.0;
export const WGS84_F = 1 / 298.257223563;
export const WGS84_E2 = WGS84_F * (2 - WGS84_F);
export const DEG = Math.PI / 180;

export type Geodetic = { lonDeg: number; latDeg: number; heightM: number };
export type Ecef = { x: number; y: number; z: number };

export function geodeticToEcef(g: Geodetic): Ecef {
  const lon = g.lonDeg * DEG;
  const lat = g.latDeg * DEG;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  return {
    x: (n + g.heightM) * cosLat * cosLon,
    y: (n + g.heightM) * cosLat * sinLon,
    z: (n * (1 - WGS84_E2) + g.heightM) * sinLat,
  };
}

export function ecefToGeodetic(p: Ecef): Geodetic {
  const lon = Math.atan2(p.y, p.x);
  let lat = Math.atan2(p.z, Math.sqrt(p.x * p.x + p.y * p.y));
  for (let i = 0; i < 5; i++) {
    const sinLat = Math.sin(lat);
    const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
    const newLat = Math.atan2(
      p.z + n * WGS84_E2 * sinLat,
      Math.sqrt(p.x * p.x + p.y * p.y)
    );
    if (Math.abs(newLat - lat) < 1e-13) break;
    lat = newLat;
  }
  const sinLat = Math.sin(lat);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  const h = Math.sqrt(p.x * p.x + p.y * p.y) / Math.cos(lat) - n;
  return { lonDeg: lon / DEG, latDeg: lat / DEG, heightM: h };
}

export function add(a: Ecef, b: Ecef): Ecef {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
export function sub(a: Ecef, b: Ecef): Ecef {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
export function scale(a: Ecef, s: number): Ecef {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}
export function dot(a: Ecef, b: Ecef): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
export function cross(a: Ecef, b: Ecef): Ecef {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
export function norm(a: Ecef): number {
  return Math.sqrt(dot(a, a));
}
export function normalize(a: Ecef): Ecef {
  return scale(a, 1 / norm(a));
}
/** Point-to-segment distance in 3D. */
export function pointSegmentDistance(p: Ecef, a: Ecef, b: Ecef): number {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / dot(ab, ab)));
  const c = add(a, scale(ab, t));
  return norm(sub(p, c));
}
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Unit east and north unit vectors at a geodetic position, in ECEF. */
export function eastNorth(g: Geodetic): { east: Ecef; north: Ecef } {
  const lon = g.lonDeg * DEG;
  const lat = g.latDeg * DEG;
  const east: Ecef = { x: -Math.sin(lon), y: Math.cos(lon), z: 0 };
  const north: Ecef = {
    x: -Math.sin(lat) * Math.cos(lon),
    y: -Math.sin(lat) * Math.sin(lon),
    z: Math.cos(lat),
  };
  return { east, north };
}
