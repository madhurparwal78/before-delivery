// The fixture ground surface: the linear interpolation, by chainage, of the neighbouring towers'
// base heights, the same across the corridor's width and held at the end towers beyond the ends.
import { baseHeightAt, type TowerMark } from "../../shared/corridorLine.js";
import { toEcef, type Centreline } from "../../shared/geodesy.js";

export interface FixtureCorridor {
  line: Centreline;
  towers: TowerMark[];
}

/**
 * Fixture-only: the chainage of a grid vertex by its along-track component in tower 1's tangent
 * plane. Within a corridor it agrees with the geodesic projection to well under a millimetre, and it
 * stays finite for the far vertices of hemisphere-sized tiles, where only the clamped end heights matter.
 */
function alongTrack(line: Centreline, lonDeg: number, latDeg: number): number {
  const origin = toEcef(line.origin.lonDeg, line.origin.latDeg, 0);
  const p = toEcef(lonDeg, latDeg, 0);
  const d = [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]] as const;
  const lambda = (line.origin.lonDeg * Math.PI) / 180;
  const phi = (line.origin.latDeg * Math.PI) / 180;
  const east = -Math.sin(lambda) * d[0] + Math.cos(lambda) * d[1];
  const north = -Math.sin(phi) * Math.cos(lambda) * d[0] - Math.sin(phi) * Math.sin(lambda) * d[1] + Math.cos(phi) * d[2];
  const azimuth = (line.azimuthDeg * Math.PI) / 180;
  return east * Math.sin(azimuth) + north * Math.cos(azimuth);
}

export function groundHeight(corridor: FixtureCorridor, lonDeg: number, latDeg: number): number {
  return baseHeightAt(corridor.towers, alongTrack(corridor.line, lonDeg, latDeg));
}
