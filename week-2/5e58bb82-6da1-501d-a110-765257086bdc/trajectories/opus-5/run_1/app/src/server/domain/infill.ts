import type { LinkState, Position } from '../../shared/types.js';
import { chordAt, directions, distance, project, spread } from './geometry.js';
import { CELL_SIZE_M, cellCentre, type Grid } from './coverage.js';
import { isOverdue } from './overdue.js';

export interface InfillCandidate {
  id: string;
  name: string;
  afloat: boolean;
  link_state: LinkState;
  hours_since_service: number;
  service_interval_h: number;
  hasLinesOnMission: boolean;
  lastFix: Position | null;
}

/**
 * The one infill eligibility decision, shared by queueing, the holidays list and
 * reassignment off a Lost vessel.
 */
export function isEligible(vessel: InfillCandidate): boolean {
  return (
    vessel.hasLinesOnMission &&
    vessel.afloat &&
    vessel.link_state === 'Live' &&
    !isOverdue(vessel.hours_since_service, vessel.service_interval_h)
  );
}

/**
 * The nearest eligible vessel to a point, by its last fix. Ties go to the
 * alphabetically first name.
 */
export function nearestEligible(
  vessels: InfillCandidate[],
  target: Position,
): InfillCandidate | null {
  let best: InfillCandidate | null = null;
  let bestDistance = Infinity;
  for (const vessel of vessels) {
    if (!isEligible(vessel)) continue;
    const gap = vessel.lastFix ? distance(vessel.lastFix, target) : Infinity;
    if (
      gap < bestDistance ||
      (gap === bestDistance && best !== null && vessel.name.localeCompare(best.name, 'en') < 0)
    ) {
      best = vessel;
      bestDistance = gap;
    }
  }
  return best;
}

/**
 * The infill line runs along the azimuth through the across-offset of the
 * holiday's centroid, from 10 m before its lowest along-line cell centre to 10 m
 * past its highest, clipped to the survey area.
 */
export function infillGeometry(
  area: Position[],
  azimuthDeg: number,
  grid: Grid,
  cells: number[],
): { start: Position; end: Position; length_m: number } | null {
  const { along, across } = directions(azimuthDeg);
  let acrossSum = 0;
  let alongMin = Infinity;
  let alongMax = -Infinity;
  for (const index of cells) {
    const centre = cellCentre(grid.origin, index % grid.cols, Math.floor(index / grid.cols));
    acrossSum += project(centre, across);
    const alongValue = project(centre, along);
    if (alongValue < alongMin) alongMin = alongValue;
    if (alongValue > alongMax) alongMax = alongValue;
  }
  const acrossValue = acrossSum / cells.length;
  const chord = chordAt(area, along, across, acrossValue);
  if (!chord) return null;
  const from = Math.max(chord.alongMin, alongMin - 10);
  const to = Math.min(chord.alongMax, alongMax + 10);
  if (to <= from) return null;
  const point = (alongValue: number): Position => ({
    easting: along.e * alongValue + across.e * acrossValue,
    northing: along.n * alongValue + across.n * acrossValue,
  });
  return { start: point(from), end: point(to), length_m: to - from };
}

/** The midpoint used to pick the nearest eligible vessel. */
export function midpoint(start: Position, end: Position): Position {
  return {
    easting: (start.easting + end.easting) / 2,
    northing: (start.northing + end.northing) / 2,
  };
}

export function areaAcrossBase(area: Position[], azimuthDeg: number): number {
  return spread(area, directions(azimuthDeg).across).min;
}

export const HOLIDAY_CELL_AREA_M2 = CELL_SIZE_M * CELL_SIZE_M;
