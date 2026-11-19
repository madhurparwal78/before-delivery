/**
 * WGS84 geodesy. Vincenty direct and inverse solutions plus ECEF conversion.
 * Every position in Spanwise is float64 metres; nothing here rounds.
 */

export const WGS84_A = 6378137;
export const WGS84_F = 1 / 298.257223563;
export const WGS84_B = WGS84_A * (1 - WGS84_F);
const E2 = WGS84_F * (2 - WGS84_F);

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function toEcef(lonDeg: number, latDeg: number, heightM: number): Vec3 {
  const lon = lonDeg * DEG;
  const lat = latDeg * DEG;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const n = WGS84_A / Math.sqrt(1 - E2 * sinLat * sinLat);
  return {
    x: (n + heightM) * cosLat * Math.cos(lon),
    y: (n + heightM) * cosLat * Math.sin(lon),
    z: (n * (1 - E2) + heightM) * sinLat,
  };
}

export function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function magnitude(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}

/** Shortest 3D distance from a point to a segment. */
export function distanceToSegment(point: Vec3, start: Vec3, end: Vec3): number {
  const seg = subtract(end, start);
  const lengthSquared = dot(seg, seg);
  const toPoint = subtract(point, start);
  const t = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, dot(toPoint, seg) / lengthSquared));
  return magnitude({
    x: toPoint.x - seg.x * t,
    y: toPoint.y - seg.y * t,
    z: toPoint.z - seg.z * t,
  });
}

export interface DirectResult {
  lonDeg: number;
  latDeg: number;
  /** Forward azimuth at the destination, degrees. */
  azimuthDeg: number;
}

/** Vincenty direct: destination of a geodesic of length `distanceM` on azimuth `azimuthDeg`. */
export function geodesicDirect(
  lonDeg: number,
  latDeg: number,
  azimuthDeg: number,
  distanceM: number,
): DirectResult {
  const lat1 = latDeg * DEG;
  const alpha1 = azimuthDeg * DEG;
  const sinAlpha1 = Math.sin(alpha1);
  const cosAlpha1 = Math.cos(alpha1);

  const tanU1 = (1 - WGS84_F) * Math.tan(lat1);
  const cosU1 = 1 / Math.sqrt(1 + tanU1 * tanU1);
  const sinU1 = tanU1 * cosU1;

  const sigma1 = Math.atan2(tanU1, cosAlpha1);
  const sinAlpha = cosU1 * sinAlpha1;
  const cosSqAlpha = 1 - sinAlpha * sinAlpha;
  const uSq = (cosSqAlpha * (WGS84_A * WGS84_A - WGS84_B * WGS84_B)) / (WGS84_B * WGS84_B);
  const bigA = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const bigB = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));

  let sigma = distanceM / (WGS84_B * bigA);
  let sinSigma = 0;
  let cosSigma = 0;
  let cos2SigmaM = 0;
  for (let i = 0; i < 20; i += 1) {
    cos2SigmaM = Math.cos(2 * sigma1 + sigma);
    sinSigma = Math.sin(sigma);
    cosSigma = Math.cos(sigma);
    const deltaSigma =
      bigB *
      sinSigma *
      (cos2SigmaM +
        (bigB / 4) *
          (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
            (bigB / 6) *
              cos2SigmaM *
              (-3 + 4 * sinSigma * sinSigma) *
              (-3 + 4 * cos2SigmaM * cos2SigmaM)));
    const next = distanceM / (WGS84_B * bigA) + deltaSigma;
    if (Math.abs(next - sigma) < 1e-14) {
      sigma = next;
      break;
    }
    sigma = next;
  }
  cos2SigmaM = Math.cos(2 * sigma1 + sigma);
  sinSigma = Math.sin(sigma);
  cosSigma = Math.cos(sigma);

  const x = sinU1 * sinSigma - cosU1 * cosSigma * cosAlpha1;
  const lat2 = Math.atan2(
    sinU1 * cosSigma + cosU1 * sinSigma * cosAlpha1,
    (1 - WGS84_F) * Math.sqrt(sinAlpha * sinAlpha + x * x),
  );
  const lambda = Math.atan2(sinSigma * sinAlpha1, cosU1 * cosSigma - sinU1 * sinSigma * cosAlpha1);
  const bigC = (WGS84_F / 16) * cosSqAlpha * (4 + WGS84_F * (4 - 3 * cosSqAlpha));
  const bigL =
    lambda -
    (1 - bigC) *
      WGS84_F *
      sinAlpha *
      (sigma +
        bigC * sinSigma * (cos2SigmaM + bigC * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
  const alpha2 = Math.atan2(sinAlpha, -x);

  return {
    lonDeg: normaliseLongitude(lonDeg + bigL * RAD),
    latDeg: lat2 * RAD,
    azimuthDeg: normaliseAzimuth(alpha2 * RAD),
  };
}

export interface InverseResult {
  distanceM: number;
  /** Initial azimuth at the first point, degrees. */
  initialAzimuthDeg: number;
}

/** Vincenty inverse: geodesic distance and initial azimuth between two points. */
export function geodesicInverse(
  lon1Deg: number,
  lat1Deg: number,
  lon2Deg: number,
  lat2Deg: number,
): InverseResult {
  const bigL = (lon2Deg - lon1Deg) * DEG;
  const u1 = Math.atan((1 - WGS84_F) * Math.tan(lat1Deg * DEG));
  const u2 = Math.atan((1 - WGS84_F) * Math.tan(lat2Deg * DEG));
  const sinU1 = Math.sin(u1);
  const cosU1 = Math.cos(u1);
  const sinU2 = Math.sin(u2);
  const cosU2 = Math.cos(u2);

  let lambda = bigL;
  let sinSigma = 0;
  let cosSigma = 1;
  let sigma = 0;
  let cosSqAlpha = 1;
  let cos2SigmaM = 1;
  let sinLambda = 0;
  let cosLambda = 1;

  for (let i = 0; i < 60; i += 1) {
    sinLambda = Math.sin(lambda);
    cosLambda = Math.cos(lambda);
    const sinSqSigma =
      cosU2 * sinLambda * (cosU2 * sinLambda) +
      (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) * (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda);
    sinSigma = Math.sqrt(sinSqSigma);
    if (sinSigma === 0) {
      return { distanceM: 0, initialAzimuthDeg: 0 };
    }
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;
    cosSqAlpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cosSqAlpha === 0 ? 0 : cosSigma - (2 * sinU1 * sinU2) / cosSqAlpha;
    const bigC = (WGS84_F / 16) * cosSqAlpha * (4 + WGS84_F * (4 - 3 * cosSqAlpha));
    const next =
      bigL +
      (1 - bigC) *
        WGS84_F *
        sinAlpha *
        (sigma +
          bigC * sinSigma * (cos2SigmaM + bigC * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
    if (Math.abs(next - lambda) < 1e-14) {
      lambda = next;
      break;
    }
    lambda = next;
  }

  const uSq = (cosSqAlpha * (WGS84_A * WGS84_A - WGS84_B * WGS84_B)) / (WGS84_B * WGS84_B);
  const bigA = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const bigB = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const deltaSigma =
    bigB *
    sinSigma *
    (cos2SigmaM +
      (bigB / 4) *
        (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
          (bigB / 6) *
            cos2SigmaM *
            (-3 + 4 * sinSigma * sinSigma) *
            (-3 + 4 * cos2SigmaM * cos2SigmaM)));

  return {
    distanceM: WGS84_B * bigA * (sigma - deltaSigma),
    initialAzimuthDeg: normaliseAzimuth(
      Math.atan2(cosU2 * sinLambda, cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) * RAD,
    ),
  };
}

export function normaliseAzimuth(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export function normaliseLongitude(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}
