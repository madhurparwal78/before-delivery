/** Derived values, landmark range and the orthographic projection of the lunar disc. */

export const MEAN_LUNAR_RADIUS_M = 1_737_400;

const DEG = 180 / Math.PI;

export type Vector = { x: number; y: number; z: number };

export type DerivedValues = {
  lat_deg: number;
  lon_deg: number;
  altitude_m: number;
  speed_m_s: number;
};

/** True when a position has no latitude: the parser cannot settle such a sample. */
export function isDegenerate(position: Vector): boolean {
  return position.x === 0 && position.y === 0 && position.z === 0;
}

export function derive(position: Vector, velocity: Vector): DerivedValues {
  const { x, y, z } = position;
  const r = Math.sqrt(x * x + y * y + z * z);
  let lon = Math.atan2(y, x) * DEG;
  if (lon <= -180) {
    lon += 360;
  }
  return {
    lat_deg: Math.atan2(z, Math.sqrt(x * x + y * y)) * DEG,
    lon_deg: lon,
    altitude_m: r - MEAN_LUNAR_RADIUS_M,
    speed_m_s: Math.sqrt(
      velocity.x * velocity.x + velocity.y * velocity.y + velocity.z * velocity.z,
    ),
  };
}

/** Haversine great-circle surface distance in metres on the mean lunar sphere. */
export function surfaceRange(
  latA: number,
  lonA: number,
  latB: number,
  lonB: number,
): number {
  const phiA = latA / DEG;
  const phiB = latB / DEG;
  const dPhi = phiB - phiA;
  const dLambda = (lonB - lonA) / DEG;
  const h =
    Math.sin(dPhi / 2) ** 2 + Math.cos(phiA) * Math.cos(phiB) * Math.sin(dLambda / 2) ** 2;
  return 2 * MEAN_LUNAR_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type Projection = { cx: number; cy: number; radius: number; lambda0: number };

export type ProjectedPoint = { x: number; y: number; visible: boolean };

/** Orthographic projection in CSS pixels from the disc element's top-left corner. */
export function project(
  latDeg: number,
  lonDeg: number,
  projection: Projection,
): ProjectedPoint {
  const phi = latDeg / DEG;
  const lambda = (lonDeg - projection.lambda0) / DEG;
  const cosPhi = Math.cos(phi);
  return {
    x: projection.cx + projection.radius * cosPhi * Math.sin(lambda),
    y: projection.cy - projection.radius * Math.sin(phi),
    visible: cosPhi * Math.cos(lambda) > 0,
  };
}

export const PICK_RADIUS_CSS_PX = 24;

export type PickCandidate = { index: number; lat_deg: number; lon_deg: number };

/** The nearest visible sample whose projection lies within 24 CSS pixels, or null. */
export function pickNearestVisible(
  candidates: readonly PickCandidate[],
  pointerX: number,
  pointerY: number,
  projection: Projection,
): number | null {
  let best: number | null = null;
  let bestDistance = PICK_RADIUS_CSS_PX;
  for (const candidate of candidates) {
    const point = project(candidate.lat_deg, candidate.lon_deg, projection);
    if (!point.visible) {
      continue;
    }
    const distance = Math.hypot(point.x - pointerX, point.y - pointerY);
    if (distance <= bestDistance) {
      best = candidate.index;
      bestDistance = distance;
    }
  }
  return best;
}
