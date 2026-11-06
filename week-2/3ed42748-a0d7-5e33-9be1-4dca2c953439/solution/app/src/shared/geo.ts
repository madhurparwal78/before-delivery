// Arc and bearing maths on Bramble, shared by the server (routes, door distance) and the
// client (route readout, ribbon). Positions are degrees; arcs are metres over the surface.

export interface LatLon {
  lat: number;
  lon: number;
}

const RAD = Math.PI / 180;

export function arcMetres(radius: number, a: LatLon, b: LatLon): number {
  const p1 = a.lat * RAD;
  const p2 = b.lat * RAD;
  const dp = p2 - p1;
  const dl = (b.lon - a.lon) * RAD;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Compass direction at the start of the shortest path, clockwise from north, whole degrees 0..359. */
export function bearingDegrees(a: LatLon, b: LatLon): number {
  const p1 = a.lat * RAD;
  const p2 = b.lat * RAD;
  const dl = (b.lon - a.lon) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  const deg = Math.round(Math.atan2(y, x) / RAD);
  return ((deg % 360) + 360) % 360;
}

export function compassLabel(bearing: number): string {
  if (bearing >= 338 || bearing <= 22) return "N";
  if (bearing <= 67) return "NE";
  if (bearing <= 112) return "E";
  if (bearing <= 157) return "SE";
  if (bearing <= 202) return "S";
  if (bearing <= 247) return "SW";
  if (bearing <= 292) return "W";
  return "NW";
}

/** Unit vector for a position: depot (0,0) faces +Z, the north pole is +Y, east is +X at the depot. */
export function unitVector(p: LatLon): [number, number, number] {
  const phi = p.lat * RAD;
  const lambda = p.lon * RAD;
  return [Math.cos(phi) * Math.sin(lambda), Math.sin(phi), Math.cos(phi) * Math.cos(lambda)];
}

export function latLonOf(v: readonly [number, number, number]): LatLon {
  const len = Math.hypot(v[0], v[1], v[2]);
  const lat = Math.asin(Math.max(-1, Math.min(1, v[1] / len))) / RAD;
  const lon = Math.atan2(v[0], v[2]) / RAD;
  return { lat, lon };
}
