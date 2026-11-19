/**
 * Corridor geometry: the centreline, chainage and offset, spans, and the
 * clearance and status derivation. These rules are decided only here.
 */

import {
  distanceToSegment,
  geodesicDirect,
  geodesicInverse,
  toEcef,
  type Vec3,
} from "./geodesy.js";
import { spanLabel } from "./format.js";

export interface TowerGeometry {
  number: number;
  chainageM: number;
  lonDeg: number;
  latDeg: number;
  baseHeightM: number;
  attachmentHeightM: number;
}

export interface CorridorGeometry {
  /** Tower 1's position and the corridor's seeded azimuth define the centreline. */
  originLonDeg: number;
  originLatDeg: number;
  azimuthDeg: number;
  lengthM: number;
  clearanceThresholdM: number;
  towers: TowerGeometry[];
}

export interface SpanRef {
  fromTower: number;
  toTower: number;
  label: string;
}

export interface CentrelinePoint {
  lonDeg: number;
  latDeg: number;
  /** Forward azimuth of the centreline at this point. */
  azimuthDeg: number;
}

/** The point on the centreline at a chainage, which may be outside [0, length]. */
export function centrelineAt(corridor: CorridorGeometry, chainageM: number): CentrelinePoint {
  if (chainageM === 0) {
    return {
      lonDeg: corridor.originLonDeg,
      latDeg: corridor.originLatDeg,
      azimuthDeg: corridor.azimuthDeg,
    };
  }
  if (chainageM > 0) {
    const forward = geodesicDirect(
      corridor.originLonDeg,
      corridor.originLatDeg,
      corridor.azimuthDeg,
      chainageM,
    );
    return { lonDeg: forward.lonDeg, latDeg: forward.latDeg, azimuthDeg: forward.azimuthDeg };
  }
  const back = geodesicDirect(
    corridor.originLonDeg,
    corridor.originLatDeg,
    corridor.azimuthDeg + 180,
    -chainageM,
  );
  return {
    lonDeg: back.lonDeg,
    latDeg: back.latDeg,
    azimuthDeg: back.azimuthDeg + 180,
  };
}

export interface Projection {
  chainageM: number;
  offsetM: number;
}

/**
 * Chainage is the geodesic distance from tower 1 to the foot of the point's
 * perpendicular on the centreline. Offset is the signed perpendicular distance,
 * positive to the right when facing increasing chainage.
 */
export function projectOntoCentreline(
  corridor: CorridorGeometry,
  lonDeg: number,
  latDeg: number,
): Projection {
  const fromOrigin = geodesicInverse(
    corridor.originLonDeg,
    corridor.originLatDeg,
    lonDeg,
    latDeg,
  );
  const bearingOffset = ((fromOrigin.initialAzimuthDeg - corridor.azimuthDeg) * Math.PI) / 180;
  let chainageM = fromOrigin.distanceM * Math.cos(bearingOffset);
  let offsetM = fromOrigin.distanceM * Math.sin(bearingOffset);

  // Newton steps on the perpendicular-foot condition. Each step walks the foot
  // along the centreline by the along-track part of the remaining separation.
  for (let i = 0; i < 8; i += 1) {
    const foot = centrelineAt(corridor, chainageM);
    const toPoint = geodesicInverse(foot.lonDeg, foot.latDeg, lonDeg, latDeg);
    if (toPoint.distanceM === 0) {
      return { chainageM, offsetM: 0 };
    }
    const theta = ((toPoint.initialAzimuthDeg - foot.azimuthDeg) * Math.PI) / 180;
    const along = toPoint.distanceM * Math.cos(theta);
    offsetM = toPoint.distanceM * Math.sin(theta);
    chainageM += along;
    if (Math.abs(along) < 1e-6) break;
  }
  return { chainageM, offsetM };
}

/** The position of a point given as chainage and offset from the centreline. */
export function positionFromChainage(
  corridor: CorridorGeometry,
  chainageM: number,
  offsetM: number,
): { lonDeg: number; latDeg: number } {
  const foot = centrelineAt(corridor, chainageM);
  if (offsetM === 0) {
    return { lonDeg: foot.lonDeg, latDeg: foot.latDeg };
  }
  const sideAzimuth = foot.azimuthDeg + (offsetM > 0 ? 90 : -90);
  const side = geodesicDirect(foot.lonDeg, foot.latDeg, sideAzimuth, Math.abs(offsetM));
  return { lonDeg: side.lonDeg, latDeg: side.latDeg };
}

/**
 * A chainage belongs to the span from tower k to tower k+1 when it is at or
 * after tower k's chainage and before tower k+1's. The corridor length belongs
 * to the last span.
 */
export function spanAt(corridor: CorridorGeometry, chainageM: number): SpanRef {
  const towers = corridor.towers;
  const last = towers.length - 1;
  let index = 0;
  for (let k = 0; k < last; k += 1) {
    if (chainageM >= towers[k].chainageM) index = k;
  }
  if (chainageM >= towers[last].chainageM) index = last - 1;
  const from = towers[index];
  const to = towers[index + 1];
  return { fromTower: from.number, toTower: to.number, label: spanLabel(from.number, to.number) };
}

/** A tower's conductor attachment point in ECEF metres. */
export function attachmentPoint(tower: TowerGeometry): Vec3 {
  return toEcef(tower.lonDeg, tower.latDeg, tower.baseHeightM + tower.attachmentHeightM);
}

/** Ground height from the linear interpolation, by chainage, of tower base heights. */
export function interpolatedBaseHeight(corridor: CorridorGeometry, chainageM: number): number {
  const towers = corridor.towers;
  if (chainageM <= towers[0].chainageM) return towers[0].baseHeightM;
  const last = towers.length - 1;
  if (chainageM >= towers[last].chainageM) return towers[last].baseHeightM;
  for (let k = 0; k < last; k += 1) {
    const a = towers[k];
    const b = towers[k + 1];
    if (chainageM >= a.chainageM && chainageM <= b.chainageM) {
      const t = (chainageM - a.chainageM) / (b.chainageM - a.chainageM);
      return a.baseHeightM + t * (b.baseHeightM - a.baseHeightM);
    }
  }
  return towers[last].baseHeightM;
}

export interface ClearanceResult {
  canopyTopHeightM: number;
  clearanceM: number;
  status: "violation" | "clear";
  span: SpanRef;
}

/**
 * The canopy top is ground height plus canopy height. Clearance is the shortest
 * 3D distance from that point to the conductor of the span containing the
 * finding's chainage. Status is violation when the clearance is strictly less
 * than the corridor's threshold.
 */
export function deriveClearance(
  corridor: CorridorGeometry,
  input: {
    chainageM: number;
    lonDeg: number;
    latDeg: number;
    groundHeightM: number;
    canopyHeightM: number;
  },
): ClearanceResult {
  const span = spanAt(corridor, input.chainageM);
  const fromTower = corridor.towers.find((t) => t.number === span.fromTower)!;
  const toTower = corridor.towers.find((t) => t.number === span.toTower)!;
  const canopyTopHeightM = input.groundHeightM + input.canopyHeightM;
  const canopyTop = toEcef(input.lonDeg, input.latDeg, canopyTopHeightM);
  const clearanceM = distanceToSegment(
    canopyTop,
    attachmentPoint(fromTower),
    attachmentPoint(toTower),
  );
  return {
    canopyTopHeightM,
    clearanceM,
    status: clearanceM < corridor.clearanceThresholdM ? "violation" : "clear",
    span,
  };
}
