import type { Hand, PieceInput, Pose, StoredPiece } from './protocol.js';

const DEG = Math.PI / 180;

function round(value: number): number {
  return Math.round(value);
}

function roundHeading(value: number): number {
  const wrapped = ((value % 360) + 360) % 360;
  return Math.round(wrapped * 1000) / 1000;
}

export function curveLengthMm(radiusMm: number, angleDeg: number): number {
  return Math.round(radiusMm * angleDeg * DEG);
}

export function frogAngleDeg(frogNumber: number): number {
  return Math.atan(1 / frogNumber) / DEG;
}

export function pieceLengthMm(input: PieceInput): number {
  return input.kind === 'curve' ? curveLengthMm(input.radius_mm, input.angle_deg) : input.length_mm;
}

function advanceStraight(start: Pose, lengthMm: number, riseMm: number, headingDeg: number): Pose {
  const heading = headingDeg * DEG;
  return {
    x_mm: round(start.x_mm + lengthMm * Math.cos(heading)),
    y_mm: round(start.y_mm + lengthMm * Math.sin(heading)),
    elevation_mm: start.elevation_mm + riseMm,
    heading_deg: roundHeading(headingDeg),
  };
}

function advanceCurve(
  start: Pose,
  radiusMm: number,
  angleDeg: number,
  hand: Hand,
  riseMm: number,
): Pose {
  const h = start.heading_deg * DEG;
  const a = angleDeg * DEG;
  if (hand === 'left') {
    return {
      x_mm: round(start.x_mm + radiusMm * (Math.sin(h + a) - Math.sin(h))),
      y_mm: round(start.y_mm + radiusMm * (Math.cos(h) - Math.cos(h + a))),
      elevation_mm: start.elevation_mm + riseMm,
      heading_deg: roundHeading(start.heading_deg + angleDeg),
    };
  }
  return {
    x_mm: round(start.x_mm + radiusMm * (Math.sin(h) - Math.sin(h - a))),
    y_mm: round(start.y_mm + radiusMm * (Math.cos(h - a) - Math.cos(h))),
    elevation_mm: start.elevation_mm + riseMm,
    heading_deg: roundHeading(start.heading_deg - angleDeg),
  };
}

/** The pose at the far end of a piece laid from `start`. */
export function endPose(start: Pose, piece: StoredPiece): Pose {
  if (piece.kind === 'curve') {
    return advanceCurve(
      start,
      piece.radius_mm ?? 0,
      piece.angle_deg ?? 0,
      piece.hand ?? 'left',
      piece.rise_mm,
    );
  }
  return advanceStraight(start, piece.length_mm, piece.rise_mm, start.heading_deg);
}

/** The pose at the diverging leg of a turnout laid from `start`. */
export function branchPose(start: Pose, piece: StoredPiece): Pose {
  const angle = frogAngleDeg(piece.frog_number ?? 6);
  const headingDeg = start.heading_deg + (piece.hand === 'right' ? -angle : angle);
  return advanceStraight(start, piece.length_mm, piece.rise_mm, headingDeg);
}

export function pointAlong(piece: StoredPiece, distanceMm: number): Pose {
  const fraction = piece.length_mm === 0 ? 0 : distanceMm / piece.length_mm;
  if (piece.kind === 'curve') {
    return advanceCurve(
      piece.start,
      piece.radius_mm ?? 0,
      (piece.angle_deg ?? 0) * fraction,
      piece.hand ?? 'left',
      piece.rise_mm * fraction,
    );
  }
  return advanceStraight(
    piece.start,
    piece.length_mm * fraction,
    piece.rise_mm * fraction,
    piece.start.heading_deg,
  );
}
