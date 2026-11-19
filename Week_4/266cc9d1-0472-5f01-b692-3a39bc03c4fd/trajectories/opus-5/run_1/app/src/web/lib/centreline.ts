/** Centreline interpolation from the corridor's towers, for camera placement. */

import { geodesicDirect, geodesicInverse } from "../../shared/geodesy.js";
import { spanLabel } from "../../shared/format.js";
import type { Tower } from "./types.js";

export interface CentrelinePoint {
  lonDeg: number;
  latDeg: number;
  azimuthDeg: number;
}

function segmentFor(towers: Tower[], chainageM: number): { from: Tower; to: Tower } {
  const last = towers.length - 1;
  if (chainageM <= towers[0].chainage_m) return { from: towers[0], to: towers[1] };
  if (chainageM >= towers[last].chainage_m) {
    return { from: towers[last - 1], to: towers[last] };
  }
  for (let k = 0; k < last; k += 1) {
    if (chainageM >= towers[k].chainage_m && chainageM <= towers[k + 1].chainage_m) {
      return { from: towers[k], to: towers[k + 1] };
    }
  }
  return { from: towers[last - 1], to: towers[last] };
}

export function centrelineAt(towers: Tower[], chainageM: number): CentrelinePoint {
  if (towers.length < 2) return { lonDeg: 0, latDeg: 0, azimuthDeg: 0 };
  const { from, to } = segmentFor(towers, chainageM);
  const leg = geodesicInverse(from.lon_deg, from.lat_deg, to.lon_deg, to.lat_deg);
  const distance = chainageM - from.chainage_m;
  if (distance === 0) {
    return { lonDeg: from.lon_deg, latDeg: from.lat_deg, azimuthDeg: leg.initialAzimuthDeg };
  }
  const point = geodesicDirect(
    from.lon_deg,
    from.lat_deg,
    leg.initialAzimuthDeg,
    distance,
  );
  return { lonDeg: point.lonDeg, latDeg: point.latDeg, azimuthDeg: point.azimuthDeg };
}

/**
 * A chainage belongs to the span from tower k to tower k+1 when it is at or
 * after tower k's chainage and before tower k+1's. The length is in the last span.
 */
export function spanAt(towers: Tower[], chainageM: number): { from: number; to: number; label: string } {
  if (towers.length < 2) return { from: 1, to: 2, label: spanLabel(1, 2) };
  const last = towers.length - 1;
  let index = 0;
  for (let k = 0; k < last; k += 1) {
    if (chainageM >= towers[k].chainage_m) index = k;
  }
  if (chainageM >= towers[last].chainage_m) index = last - 1;
  return {
    from: towers[index].number,
    to: towers[index + 1].number,
    label: spanLabel(towers[index].number, towers[index + 1].number),
  };
}

export function nearestTower(towers: Tower[], chainageM: number): Tower {
  let best = towers[0];
  let bestDistance = Math.abs(chainageM - best.chainage_m);
  for (const tower of towers.slice(1)) {
    const distance = Math.abs(chainageM - tower.chainage_m);
    if (distance < bestDistance) {
      best = tower;
      bestDistance = distance;
    }
  }
  return best;
}

/** Ground height interpolated from tower base heights, used before terrain loads. */
export function baseHeightAt(towers: Tower[], chainageM: number): number {
  if (towers.length === 0) return 0;
  const last = towers.length - 1;
  if (chainageM <= towers[0].chainage_m) return towers[0].base_height_m;
  if (chainageM >= towers[last].chainage_m) return towers[last].base_height_m;
  for (let k = 0; k < last; k += 1) {
    const a = towers[k];
    const b = towers[k + 1];
    if (chainageM >= a.chainage_m && chainageM <= b.chainage_m) {
      const t = (chainageM - a.chainage_m) / (b.chainage_m - a.chainage_m);
      return a.base_height_m + t * (b.base_height_m - a.base_height_m);
    }
  }
  return towers[last].base_height_m;
}

export function previousTowerChainage(towers: Tower[], chainageM: number): number {
  const earlier = towers.filter((tower) => tower.chainage_m < chainageM - 1e-9);
  return earlier.length > 0 ? earlier[earlier.length - 1].chainage_m : 0;
}

export function nextTowerChainage(towers: Tower[], chainageM: number, lengthM: number): number {
  const later = towers.find((tower) => tower.chainage_m > chainageM + 1e-9);
  return later ? later.chainage_m : lengthM;
}
