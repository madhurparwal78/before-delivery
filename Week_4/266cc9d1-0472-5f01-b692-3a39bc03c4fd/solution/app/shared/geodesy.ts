// WGS84 geometry: ECEF conversion, Vincenty's direct and inverse geodesic, and the
// projection of a point onto a corridor centreline (chainage and offset).

/** The WGS84 ellipsoid: semi-major axis, flattening and semi-minor axis, in metres. */
export const WGS84_A = 6_378_137;
const F = 1 / 298.257223563;
export const WGS84_B = WGS84_A * (1 - F);
const A = WGS84_A;
const B = WGS84_B;
const E2 = F * (2 - F);
const DEG = Math.PI / 180;

export type Ecef = [number, number, number];

interface GeoPoint {
  lonDeg: number;
  latDeg: number;
}

export function toEcef(lonDeg: number, latDeg: number, heightM: number): Ecef {
  const phi = latDeg * DEG;
  const lambda = lonDeg * DEG;
  const n = A / Math.sqrt(1 - E2 * Math.sin(phi) ** 2);
  return [
    (n + heightM) * Math.cos(phi) * Math.cos(lambda),
    (n + heightM) * Math.cos(phi) * Math.sin(lambda),
    (n * (1 - E2) + heightM) * Math.sin(phi),
  ];
}

/** Shortest distance from point p to the segment a–b, all in ECEF metres. */
export function distanceToSegment(p: Ecef, a: Ecef, b: Ecef): number {
  const ab: Ecef = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap: Ecef = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const lengthSquared = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / lengthSquared));
  return Math.hypot(ap[0] - t * ab[0], ap[1] - t * ab[1], ap[2] - t * ab[2]);
}

/** Vincenty direct: the point `distanceM` from `start` along initial azimuth, and the azimuth there. */
export function direct(start: GeoPoint, azimuthDeg: number, distanceM: number): GeoPoint & { azimuthDeg: number } {
  const alpha1 = azimuthDeg * DEG;
  const sinAlpha1 = Math.sin(alpha1);
  const cosAlpha1 = Math.cos(alpha1);
  const tanU1 = (1 - F) * Math.tan(start.latDeg * DEG);
  const cosU1 = 1 / Math.sqrt(1 + tanU1 * tanU1);
  const sinU1 = tanU1 * cosU1;
  const sigma1 = Math.atan2(tanU1, cosAlpha1);
  const sinAlpha = cosU1 * sinAlpha1;
  const cosSqAlpha = 1 - sinAlpha * sinAlpha;
  const uSq = (cosSqAlpha * (A * A - B * B)) / (B * B);
  const bigA = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const bigB = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));

  let sigma = distanceM / (B * bigA);
  let previous: number;
  let cos2SigmaM: number;
  let sinSigma: number;
  let cosSigma: number;
  do {
    cos2SigmaM = Math.cos(2 * sigma1 + sigma);
    sinSigma = Math.sin(sigma);
    cosSigma = Math.cos(sigma);
    const deltaSigma =
      bigB *
      sinSigma *
      (cos2SigmaM +
        (bigB / 4) *
          (cosSigma * (-1 + 2 * cos2SigmaM ** 2) -
            (bigB / 6) * cos2SigmaM * (-3 + 4 * sinSigma ** 2) * (-3 + 4 * cos2SigmaM ** 2)));
    previous = sigma;
    sigma = distanceM / (B * bigA) + deltaSigma;
  } while (Math.abs(sigma - previous) > 1e-14);

  const x = sinU1 * sinSigma - cosU1 * cosSigma * cosAlpha1;
  const lat = Math.atan2(sinU1 * cosSigma + cosU1 * sinSigma * cosAlpha1, (1 - F) * Math.sqrt(sinAlpha ** 2 + x * x));
  const lambda = Math.atan2(sinSigma * sinAlpha1, cosU1 * cosSigma - sinU1 * sinSigma * cosAlpha1);
  const c = (F / 16) * cosSqAlpha * (4 + F * (4 - 3 * cosSqAlpha));
  const l =
    lambda -
    (1 - c) * F * sinAlpha * (sigma + c * sinSigma * (cos2SigmaM + c * cosSigma * (-1 + 2 * cos2SigmaM ** 2)));
  const alpha2 = Math.atan2(sinAlpha, -x);
  return { lonDeg: start.lonDeg + l / DEG, latDeg: lat / DEG, azimuthDeg: alpha2 / DEG };
}

/** Vincenty inverse: geodesic distance and the initial azimuth from `from` towards `to`. */
export function inverse(from: GeoPoint, to: GeoPoint): { distanceM: number; azimuthDeg: number } {
  const l = (to.lonDeg - from.lonDeg) * DEG;
  const u1 = Math.atan((1 - F) * Math.tan(from.latDeg * DEG));
  const u2 = Math.atan((1 - F) * Math.tan(to.latDeg * DEG));
  const sinU1 = Math.sin(u1);
  const cosU1 = Math.cos(u1);
  const sinU2 = Math.sin(u2);
  const cosU2 = Math.cos(u2);

  let lambda = l;
  let previous: number;
  let sinSigma = 0;
  let cosSigma = 1;
  let sigma = 0;
  let cosSqAlpha = 1;
  let cos2SigmaM = 0;
  let sinLambda = 0;
  let cosLambda = 1;
  let iterations = 0;
  do {
    sinLambda = Math.sin(lambda);
    cosLambda = Math.cos(lambda);
    sinSigma = Math.hypot(cosU2 * sinLambda, cosU1 * sinU2 - sinU1 * cosU2 * cosLambda);
    if (sinSigma === 0) return { distanceM: 0, azimuthDeg: 0 };
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;
    cosSqAlpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cosSqAlpha === 0 ? 0 : cosSigma - (2 * sinU1 * sinU2) / cosSqAlpha;
    const c = (F / 16) * cosSqAlpha * (4 + F * (4 - 3 * cosSqAlpha));
    previous = lambda;
    lambda =
      l + (1 - c) * F * sinAlpha * (sigma + c * sinSigma * (cos2SigmaM + c * cosSigma * (-1 + 2 * cos2SigmaM ** 2)));
    iterations += 1;
  } while (Math.abs(lambda - previous) > 1e-13 && iterations < 200);

  const uSq = (cosSqAlpha * (A * A - B * B)) / (B * B);
  const bigA = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const bigB = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const deltaSigma =
    bigB *
    sinSigma *
    (cos2SigmaM +
      (bigB / 4) *
        (cosSigma * (-1 + 2 * cos2SigmaM ** 2) -
          (bigB / 6) * cos2SigmaM * (-3 + 4 * sinSigma ** 2) * (-3 + 4 * cos2SigmaM ** 2)));
  const azimuth = Math.atan2(cosU2 * sinLambda, cosU1 * sinU2 - sinU1 * cosU2 * cosLambda);
  return { distanceM: B * bigA * (sigma - deltaSigma), azimuthDeg: azimuth / DEG };
}

/** A corridor centreline: the geodesic leaving tower 1 at the seeded azimuth. */
export interface Centreline {
  origin: GeoPoint;
  azimuthDeg: number;
}

/** The centreline point at a chainage (negative chainages extend back past tower 1) and the direction of increasing chainage there. */
function footAt(line: Centreline, chainageM: number): GeoPoint & { alongDeg: number } {
  if (chainageM >= 0) {
    const foot = direct(line.origin, line.azimuthDeg, chainageM);
    return { lonDeg: foot.lonDeg, latDeg: foot.latDeg, alongDeg: foot.azimuthDeg };
  }
  const foot = direct(line.origin, line.azimuthDeg + 180, -chainageM);
  return { lonDeg: foot.lonDeg, latDeg: foot.latDeg, alongDeg: foot.azimuthDeg + 180 };
}

/** The point at `chainageM` along the centreline, then `offsetM` to the right (negative: left). */
export function pointAt(line: Centreline, chainageM: number, offsetM: number): GeoPoint {
  const foot = footAt(line, chainageM);
  if (offsetM === 0) return { lonDeg: foot.lonDeg, latDeg: foot.latDeg };
  const placed = direct(foot, offsetM > 0 ? foot.alongDeg + 90 : foot.alongDeg - 90, Math.abs(offsetM));
  return { lonDeg: placed.lonDeg, latDeg: placed.latDeg };
}

function normaliseDegrees(angle: number): number {
  return ((((angle + 180) % 360) + 360) % 360) - 180;
}

/**
 * Chainage is the geodesic distance from tower 1 to the foot of the point's perpendicular on the
 * centreline; offset is the signed perpendicular distance, positive to the right of increasing chainage.
 */
export function project(line: Centreline, point: GeoPoint): { chainageM: number; offsetM: number } {
  const first = inverse(line.origin, point);
  let chainageM = first.distanceM * Math.cos((first.azimuthDeg - line.azimuthDeg) * DEG);
  let foot = footAt(line, chainageM);
  for (let i = 0; i < 30; i += 1) {
    const towards = inverse(foot, point);
    const step = towards.distanceM * Math.cos((towards.azimuthDeg - foot.alongDeg) * DEG);
    chainageM += step;
    foot = footAt(line, chainageM);
    if (Math.abs(step) < 1e-7) break;
  }
  const towards = inverse(foot, point);
  const offsetM = normaliseDegrees(towards.azimuthDeg - foot.alongDeg) >= 0 ? towards.distanceM : -towards.distanceM;
  return { chainageM, offsetM };
}
