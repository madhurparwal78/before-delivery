import { LAYOUTS, type LayoutId, type LayoutSpec } from '../shared/catalogue.js';

export interface TrackPoint {
  x: number;
  z: number;
  heading: number;
}

type Piece =
  | { kind: 'straight'; length: number; x: number; z: number; heading: number }
  | {
      kind: 'arc';
      length: number;
      centreX: number;
      centreZ: number;
      radius: number;
      from: number;
    };

export interface TrackGeometry {
  pointAt: (distance: number) => TrackPoint;
  lengthM: number;
  halfWidth: number;
}

const LANE_WIDTH = 4;
const TRACK_HALF_WIDTH = 6;

function buildGeometry(layout: LayoutSpec): TrackGeometry {
  const total = layout.lengthM;
  const radius = total / 16;
  const remaining = total - 2 * Math.PI * radius;
  const shortSide = remaining / 5.2;
  const longSide = 1.6 * shortSide;
  const halfLong = longSide / 2;
  const halfShort = shortSide / 2;
  const quarter = (Math.PI * radius) / 2;

  const pieces: Piece[] = [
    { kind: 'straight', length: longSide, x: -halfLong, z: -(halfShort + radius), heading: 0 },
    { kind: 'arc', length: quarter, centreX: halfLong, centreZ: -halfShort, radius, from: -Math.PI / 2 },
    { kind: 'straight', length: shortSide, x: halfLong + radius, z: -halfShort, heading: Math.PI / 2 },
    { kind: 'arc', length: quarter, centreX: halfLong, centreZ: halfShort, radius, from: 0 },
    { kind: 'straight', length: longSide, x: halfLong, z: halfShort + radius, heading: Math.PI },
    {
      kind: 'arc',
      length: quarter,
      centreX: -halfLong,
      centreZ: halfShort,
      radius,
      from: Math.PI / 2,
    },
    {
      kind: 'straight',
      length: shortSide,
      x: -(halfLong + radius),
      z: halfShort,
      heading: -Math.PI / 2,
    },
    { kind: 'arc', length: quarter, centreX: -halfLong, centreZ: -halfShort, radius, from: Math.PI },
  ];

  const pointAt = (distance: number): TrackPoint => {
    let left = ((distance % total) + total) % total;
    for (const piece of pieces) {
      if (left > piece.length) {
        left -= piece.length;
        continue;
      }
      if (piece.kind === 'straight') {
        return {
          x: piece.x + Math.cos(piece.heading) * left,
          z: piece.z + Math.sin(piece.heading) * left,
          heading: piece.heading,
        };
      }
      const angle = piece.from + left / piece.radius;
      return {
        x: piece.centreX + Math.cos(angle) * piece.radius,
        z: piece.centreZ + Math.sin(angle) * piece.radius,
        heading: angle + Math.PI / 2,
      };
    }
    return { x: 0, z: 0, heading: 0 };
  };

  return { pointAt, lengthM: total, halfWidth: TRACK_HALF_WIDTH };
}

const cache = new Map<LayoutId, TrackGeometry>();

export function trackGeometry(layoutId: LayoutId): TrackGeometry {
  const existing = cache.get(layoutId);
  if (existing) return existing;
  const geometry = buildGeometry(LAYOUTS[layoutId]);
  cache.set(layoutId, geometry);
  return geometry;
}

export function laneOffset(lane: 'left' | 'middle' | 'right'): number {
  if (lane === 'left') return -LANE_WIDTH;
  if (lane === 'right') return LANE_WIDTH;
  return 0;
}

export function offsetPoint(point: TrackPoint, offset: number): { x: number; z: number } {
  return {
    x: point.x - Math.sin(point.heading) * offset,
    z: point.z + Math.cos(point.heading) * offset,
  };
}
