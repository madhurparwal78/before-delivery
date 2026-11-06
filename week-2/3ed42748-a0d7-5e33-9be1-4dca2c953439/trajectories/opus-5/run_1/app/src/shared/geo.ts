export interface LatLon {
  lat: number;
  lon: number;
}

const toRad = Math.PI / 180;
const toDeg = 180 / Math.PI;

/** Central angle, in radians, between two positions on a sphere. */
function centralAngle(from: LatLon, to: LatLon): number {
  const phi1 = from.lat * toRad;
  const phi2 = to.lat * toRad;
  const dLambda = (to.lon - from.lon) * toRad;
  const sinHalfLat = Math.sin((phi2 - phi1) / 2);
  const sinHalfLon = Math.sin(dLambda / 2);
  const h = sinHalfLat * sinHalfLat + Math.cos(phi1) * Math.cos(phi2) * sinHalfLon * sinHalfLon;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Shortest distance over the surface, in metres. */
export function arcMetres(from: LatLon, to: LatLon, radiusM: number): number {
  return centralAngle(from, to) * radiusM;
}

/** Compass direction at the start of the shortest path, clockwise from north, 0 to 359. */
export function initialBearingDeg(from: LatLon, to: LatLon): number {
  const phi1 = from.lat * toRad;
  const phi2 = to.lat * toRad;
  const dLambda = (to.lon - from.lon) * toRad;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  const deg = Math.atan2(y, x) * toDeg;
  return Math.round((deg + 360) % 360) % 360;
}

const labels: Array<{ label: string; from: number; to: number }> = [
  { label: 'NE', from: 23, to: 67 },
  { label: 'E', from: 68, to: 112 },
  { label: 'SE', from: 113, to: 157 },
  { label: 'S', from: 158, to: 202 },
  { label: 'SW', from: 203, to: 247 },
  { label: 'W', from: 248, to: 292 },
  { label: 'NW', from: 293, to: 337 },
];

export function compassLabel(bearingDeg: number): string {
  for (const band of labels) {
    if (bearingDeg >= band.from && bearingDeg <= band.to) return band.label;
  }
  return 'N';
}

/** Unit vector on the sphere for a position, with +Y through the north pole. */
export function toUnitVector({ lat, lon }: LatLon): [number, number, number] {
  const phi = lat * toRad;
  const lambda = lon * toRad;
  const cosPhi = Math.cos(phi);
  return [cosPhi * Math.sin(lambda), Math.sin(phi), cosPhi * Math.cos(lambda)];
}

export function fromUnitVector(v: readonly [number, number, number]): LatLon {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  const y = v[1] / length;
  return {
    lat: Math.asin(Math.max(-1, Math.min(1, y))) * toDeg,
    lon: Math.atan2(v[0] / length, v[2] / length) * toDeg,
  };
}

/** The point a fraction of the way along the shortest path between two positions. */
export function interpolate(from: LatLon, to: LatLon, fraction: number): LatLon {
  const angle = centralAngle(from, to);
  const a = toUnitVector(from);
  const b = toUnitVector(to);
  if (angle < 1e-9) return { ...from };
  const sin = Math.sin(angle);
  const wa = Math.sin((1 - fraction) * angle) / sin;
  const wb = Math.sin(fraction * angle) / sin;
  return fromUnitVector([
    a[0] * wa + b[0] * wb,
    a[1] * wa + b[1] * wb,
    a[2] * wa + b[2] * wb,
  ]);
}

/** Walks `metres` from a position along a bearing, over the surface. */
export function travel(from: LatLon, bearingDeg: number, metres: number, radiusM: number): LatLon {
  const angle = metres / radiusM;
  const phi1 = from.lat * toRad;
  const lambda1 = from.lon * toRad;
  const theta = bearingDeg * toRad;
  const sinPhi = Math.sin(phi1) * Math.cos(angle) + Math.cos(phi1) * Math.sin(angle) * Math.cos(theta);
  const phi2 = Math.asin(Math.max(-1, Math.min(1, sinPhi)));
  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(angle) * Math.cos(phi1),
      Math.cos(angle) - Math.sin(phi1) * sinPhi,
    );
  return { lat: phi2 * toDeg, lon: (((lambda2 * toDeg + 540) % 360) - 180) };
}
