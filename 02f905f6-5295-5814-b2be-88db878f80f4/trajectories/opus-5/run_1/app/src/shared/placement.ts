import type { Cone, GlazeCone, PlacementReason, Rotation, Shape, Stage } from './types';
import { clayRatedFor } from './labels';

/**
 * Footprint geometry is worked out in quarter-inch units, where every size,
 * coordinate, circle centre and radius on the shelf is a whole number.
 * Sides and coordinates arrive in half-inch units.
 */
const QUARTER_PER_HALF = 2;

export const SHELF_SPAN_HALF_UNITS = 46; // 23.0 in
const SHELF_CENTRE_Q = 46; // 11.5 in in quarter units
const SHELF_RADIUS_Q = 46; // 11.5 in in quarter units

export interface PostSquare {
  /** Top-left corner and size in half-inch units. */
  x: number;
  y: number;
  size: number;
}

export const SHELF_POSTS: PostSquare[] = [
  { x: 22, y: 1, size: 2 },
  { x: 5, y: 33, size: 2 },
  { x: 39, y: 33, size: 2 },
];

export type Footprint =
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'rect'; x0: number; y0: number; x1: number; y1: number };

export interface FootprintSides {
  shape: Shape;
  /** Along x at 0 degrees, in half-inch units. */
  width: number;
  /** Along y at 0 degrees, in half-inch units. */
  depth: number;
}

/** The footprint of a piece at a spot, in quarter-inch units. */
export function footprintOf(
  sides: FootprintSides,
  x: number,
  y: number,
  rotation: Rotation,
): Footprint {
  const xq = x * QUARTER_PER_HALF;
  const yq = y * QUARTER_PER_HALF;
  if (sides.shape === 'rectangular') {
    const turned = rotation === 90 || rotation === 270;
    const wq = (turned ? sides.depth : sides.width) * QUARTER_PER_HALF;
    const dq = (turned ? sides.width : sides.depth) * QUARTER_PER_HALF;
    return { kind: 'rect', x0: xq, y0: yq, x1: xq + wq, y1: yq + dq };
  }
  const r = sides.width; // half the diameter, in quarter units
  return { kind: 'circle', cx: xq + r, cy: yq + r, r };
}

/** Footprint span along x and y in half-inch units, after rotation. */
export function footprintSpan(
  sides: FootprintSides,
  rotation: Rotation,
): { width: number; depth: number } {
  if (sides.shape !== 'rectangular') return { width: sides.width, depth: sides.depth };
  const turned = rotation === 90 || rotation === 270;
  return turned
    ? { width: sides.depth, depth: sides.width }
    : { width: sides.width, depth: sides.depth };
}

function squared(value: number): number {
  return value * value;
}

/** Whole footprint inside the shelf circle; touching the rim is allowed. */
function insideShelf(footprint: Footprint): boolean {
  if (footprint.kind === 'rect') {
    const corners: [number, number][] = [
      [footprint.x0, footprint.y0],
      [footprint.x1, footprint.y0],
      [footprint.x0, footprint.y1],
      [footprint.x1, footprint.y1],
    ];
    return corners.every(
      ([cx, cy]) =>
        squared(cx - SHELF_CENTRE_Q) + squared(cy - SHELF_CENTRE_Q) <= squared(SHELF_RADIUS_Q),
    );
  }
  const slack = SHELF_RADIUS_Q - footprint.r;
  if (slack < 0) return false;
  return (
    squared(footprint.cx - SHELF_CENTRE_Q) + squared(footprint.cy - SHELF_CENTRE_Q) <=
    squared(slack)
  );
}

function rectOf(x: number, y: number, size: number): Footprint {
  const x0 = x * QUARTER_PER_HALF;
  const y0 = y * QUARTER_PER_HALF;
  return { kind: 'rect', x0, y0, x1: x0 + size * QUARTER_PER_HALF, y1: y0 + size * QUARTER_PER_HALF };
}

/** Do two footprints share any interior area? Touching edges do not. */
function interiorsMeet(a: Footprint, b: Footprint): boolean {
  if (a.kind === 'rect' && b.kind === 'rect') {
    return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  }
  if (a.kind === 'circle' && b.kind === 'circle') {
    return squared(a.cx - b.cx) + squared(a.cy - b.cy) < squared(a.r + b.r);
  }
  const circle = a.kind === 'circle' ? a : (b as Extract<Footprint, { kind: 'circle' }>);
  const rect = a.kind === 'rect' ? a : (b as Extract<Footprint, { kind: 'rect' }>);
  const dx = Math.max(rect.x0 - circle.cx, 0, circle.cx - rect.x1);
  const dy = Math.max(rect.y0 - circle.cy, 0, circle.cy - rect.y1);
  return squared(dx) + squared(dy) < squared(circle.r);
}

export interface PlacementCandidate {
  sides: FootprintSides;
  /** Rounded height in half-inch units. */
  height: number;
  stage: Stage | null;
  clayMaxCone: Cone;
  glazeCone: GlazeCone | null;
  x: number;
  y: number;
  rotation: Rotation;
}

export interface PlacementContext {
  firingStage: Stage;
  firingCone: Cone;
  /** Post height in half-inch units. */
  postHeight: number;
  /** Footprints already saved on this layer, by piece number. */
  occupied: { pieceNumber: string; footprint: Footprint }[];
}

export interface Refusal {
  reason: PlacementReason;
  message: string;
}

/**
 * The one place a placement is judged. Checks run in order and the first
 * failure is the only one reported.
 */
export function judgePlacement(
  candidate: PlacementCandidate,
  context: PlacementContext,
): Refusal | null {
  if (candidate.stage !== context.firingStage) {
    const needs = candidate.stage ?? 'no';
    return { reason: 'stage', message: `Wrong stage: piece needs ${needs} firing` };
  }
  if (!clayRatedFor(candidate.clayMaxCone, context.firingCone)) {
    return { reason: 'clay', message: `Clay not rated for cone ${context.firingCone}` };
  }
  if (context.firingStage === 'glaze' && candidate.glazeCone !== context.firingCone) {
    return { reason: 'cone', message: `Wrong cone: piece is cone ${candidate.glazeCone ?? 'none'}` };
  }
  if (candidate.height + 2 > context.postHeight) {
    return { reason: 'height', message: 'Too tall for this layer' };
  }
  const footprint = footprintOf(candidate.sides, candidate.x, candidate.y, candidate.rotation);
  if (!insideShelf(footprint)) {
    return { reason: 'edge', message: 'Past shelf edge' };
  }
  for (const post of SHELF_POSTS) {
    if (interiorsMeet(footprint, rectOf(post.x, post.y, post.size))) {
      return { reason: 'post', message: 'Overlaps post' };
    }
  }
  const hits = context.occupied
    .filter((other) => interiorsMeet(footprint, other.footprint))
    .map((other) => other.pieceNumber)
    .sort();
  const lowest = hits[0];
  if (lowest !== undefined) {
    return { reason: 'overlap', message: `Overlaps Piece ${lowest}` };
  }
  return null;
}

export const PLACEMENT_FIELD_MSG = {
  piece_number: 'Choose a queued piece',
  layer: 'Choose a layer on this kiln',
  coordinate: 'Use a half-inch step from 0 to 23',
  rotation: 'Use 0, 90, 180 or 270',
} as const;

/** Parses a coordinate in inches into half-inch units. */
export function parseCoordinate(raw: unknown): number | null {
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : null;
  if (text === null || !/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole = '0', fraction = ''] = text.split('.');
  const hundredths = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
  if (hundredths % 50 !== 0) return null;
  const halfUnits = hundredths / 50;
  if (halfUnits < 0 || halfUnits > SHELF_SPAN_HALF_UNITS) return null;
  return halfUnits;
}

export function parseRotation(raw: unknown): Rotation | null {
  const value = typeof raw === 'string' ? Number(raw.trim()) : raw;
  return value === 0 || value === 90 || value === 180 || value === 270 ? value : null;
}
