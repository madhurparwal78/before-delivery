import {
  offCentreLineMessage,
  offWallMessage,
  tooBrightMessage,
  tooCloseMessage,
} from '../../shared/copy';
import type { RejectionReason } from '../../shared/types';
import { CENTRE_LINE_MM, MIN_GAP_MM } from '../../shared/units';

export interface HangCandidate {
  offsetMm: number;
  centreHeightMm: number;
  widthMm: number;
  heightMm: number;
  heightOverride: boolean;
  luxLimit: number;
}

export interface HangWall {
  name: string;
  lengthMm: number;
  heightMm: number;
  plannedLux: number;
}

export interface Neighbour {
  title: string;
  offsetMm: number;
  widthMm: number;
}

export interface HangRejection {
  reason: RejectionReason;
  message: string;
}

/** The hang rules, checked in their published order; the first failure is the rejection. */
export function checkHangRules(
  candidate: HangCandidate,
  wall: HangWall,
  neighbours: readonly Neighbour[],
): HangRejection | null {
  const left = candidate.offsetMm - candidate.widthMm / 2;
  const right = candidate.offsetMm + candidate.widthMm / 2;
  const bottom = candidate.centreHeightMm - candidate.heightMm / 2;
  const top = candidate.centreHeightMm + candidate.heightMm / 2;

  if (left < 0 || right > wall.lengthMm || bottom < 0 || top > wall.heightMm) {
    return { reason: 'off_wall', message: offWallMessage(wall.name) };
  }

  if (!candidate.heightOverride && candidate.centreHeightMm !== CENTRE_LINE_MM) {
    return { reason: 'off_centre_line', message: offCentreLineMessage };
  }

  let tightest: { gap: number; neighbour: Neighbour } | null = null;
  for (const neighbour of neighbours) {
    const nLeft = neighbour.offsetMm - neighbour.widthMm / 2;
    const nRight = neighbour.offsetMm + neighbour.widthMm / 2;
    const gap = Math.max(left - nRight, nLeft - right);
    if (gap >= MIN_GAP_MM) continue;
    if (
      tightest === null ||
      gap < tightest.gap ||
      (gap === tightest.gap && neighbour.offsetMm < tightest.neighbour.offsetMm)
    ) {
      tightest = { gap, neighbour };
    }
  }
  if (tightest) {
    return { reason: 'too_close', message: tooCloseMessage(tightest.neighbour.title) };
  }

  if (wall.plannedLux > candidate.luxLimit) {
    return {
      reason: 'too_bright',
      message: tooBrightMessage(wall.name, wall.plannedLux, candidate.luxLimit),
    };
  }

  return null;
}
