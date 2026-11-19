import type { LayoutContent, ModuleContent, StoredPiece } from '../../shared/protocol.js';
import { pointAlong } from '../../shared/geometry.js';

export interface TrackPoint {
  x: number;
  y: number;
  elevation: number;
  heading: number;
}

export interface BlockTrack {
  blockId: string;
  points: TrackPoint[];
  lengthMm: number;
}

function samplePiece(piece: StoredPiece): TrackPoint[] {
  const steps = piece.kind === 'curve' ? 8 : 2;
  const points: TrackPoint[] = [];
  for (let step = 1; step <= steps; step += 1) {
    const pose = pointAlong(piece, (piece.length_mm * step) / steps);
    points.push({
      x: pose.x_mm,
      y: pose.y_mm,
      elevation: pose.elevation_mm,
      heading: pose.heading_deg,
    });
  }
  return points;
}

export function piecePolyline(piece: StoredPiece): TrackPoint[] {
  return [
    {
      x: piece.start.x_mm,
      y: piece.start.y_mm,
      elevation: piece.start.elevation_mm,
      heading: piece.start.heading_deg,
    },
    ...samplePiece(piece),
  ];
}

/** The running line of each block, taken from its pieces in chain order. */
export function blockTracks(content: LayoutContent): Map<string, BlockTrack> {
  const tracks = new Map<string, BlockTrack>();
  for (const module of content.modules) {
    for (const piece of module.pieces) {
      if (!piece.block_id) continue;
      const existing = tracks.get(piece.block_id) ?? {
        blockId: piece.block_id,
        points: [],
        lengthMm: 0,
      };
      const line = piecePolyline(piece);
      existing.points.push(...(existing.points.length === 0 ? line : line.slice(1)));
      existing.lengthMm += piece.length_mm;
      tracks.set(piece.block_id, existing);
    }
  }
  return tracks;
}

export function pointOnBlock(track: BlockTrack, distanceMm: number): TrackPoint {
  const clamped = Math.max(0, Math.min(distanceMm, track.lengthMm));
  let walked = 0;
  for (let index = 1; index < track.points.length; index += 1) {
    const from = track.points[index - 1];
    const to = track.points[index];
    const span = Math.hypot(to.x - from.x, to.y - from.y);
    if (walked + span >= clamped || index === track.points.length - 1) {
      const fraction = span === 0 ? 0 : (clamped - walked) / span;
      return {
        x: from.x + (to.x - from.x) * fraction,
        y: from.y + (to.y - from.y) * fraction,
        elevation: from.elevation + (to.elevation - from.elevation) * fraction,
        heading: (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI,
      };
    }
    walked += span;
  }
  return track.points[0] ?? { x: 0, y: 0, elevation: 0, heading: 0 };
}

export function moduleBounds(module: ModuleContent): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  let minX = module.origin.x_mm;
  let maxX = module.origin.x_mm;
  let minY = module.origin.y_mm;
  let maxY = module.origin.y_mm;
  for (const piece of module.pieces) {
    for (const pose of [piece.start, piece.end]) {
      minX = Math.min(minX, pose.x_mm);
      maxX = Math.max(maxX, pose.x_mm);
      minY = Math.min(minY, pose.y_mm);
      maxY = Math.max(maxY, pose.y_mm);
    }
  }
  return { minX: minX - 400, maxX: maxX + 400, minY: minY - 500, maxY: maxY + 500 };
}

export function contentBounds(content: LayoutContent): {
  centreX: number;
  centreY: number;
  spanX: number;
  spanY: number;
} {
  if (content.modules.length === 0) {
    return { centreX: 0, centreY: 0, spanX: 6000, spanY: 4000 };
  }
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const module of content.modules) {
    const bounds = moduleBounds(module);
    minX = Math.min(minX, bounds.minX);
    maxX = Math.max(maxX, bounds.maxX);
    minY = Math.min(minY, bounds.minY);
    maxY = Math.max(maxY, bounds.maxY);
  }
  return {
    centreX: (minX + maxX) / 2,
    centreY: (minY + maxY) / 2,
    spanX: Math.max(maxX - minX, 2000),
    spanY: Math.max(maxY - minY, 2000),
  };
}
