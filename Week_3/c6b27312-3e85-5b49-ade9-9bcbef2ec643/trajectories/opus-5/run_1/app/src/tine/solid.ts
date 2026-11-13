import { CanonicalValue, canonicalJson } from '../shared/canonical';
import { roundTo } from '../shared/numbers';

export type SolidOp =
  | { op: 'box'; w: number; d: number; h: number }
  | { op: 'cylinder'; dia: number; h: number }
  | { op: 'boss'; dia: number; h: number; x: number; y: number }
  | { op: 'hole'; dia: number; x: number; y: number }
  | { op: 'slot'; w: number; len: number; x: number; y: number };

export type Solid = { ops: SolidOp[] };

export type Bbox = [number, number, number];

function roundOp(op: SolidOp): SolidOp {
  switch (op.op) {
    case 'box':
      return { op: 'box', w: roundTo(op.w, 3), d: roundTo(op.d, 3), h: roundTo(op.h, 3) };
    case 'cylinder':
      return { op: 'cylinder', dia: roundTo(op.dia, 3), h: roundTo(op.h, 3) };
    case 'boss':
      return {
        op: 'boss',
        dia: roundTo(op.dia, 3),
        h: roundTo(op.h, 3),
        x: roundTo(op.x, 3),
        y: roundTo(op.y, 3),
      };
    case 'hole':
      return { op: 'hole', dia: roundTo(op.dia, 3), x: roundTo(op.x, 3), y: roundTo(op.y, 3) };
    case 'slot':
      return {
        op: 'slot',
        w: roundTo(op.w, 3),
        len: roundTo(op.len, 3),
        x: roundTo(op.x, 3),
        y: roundTo(op.y, 3),
      };
  }
}

function opX(op: SolidOp): number {
  return 'x' in op ? op.x : 0;
}

function opY(op: SolidOp): number {
  return 'y' in op ? op.y : 0;
}

/**
 * The solid in digest order: the body first, then the cuts and joins with repeats
 * expanded, sorted by op name, then x, then y. Every number rounded to 0.001.
 */
export function canonicalSolid(ops: SolidOp[]): Solid {
  const rounded = ops.map(roundOp);
  const body = rounded.filter((op) => op.op === 'box' || op.op === 'cylinder');
  const rest = rounded.filter((op) => op.op !== 'box' && op.op !== 'cylinder');
  rest.sort((a, b) => {
    if (a.op !== b.op) return a.op < b.op ? -1 : 1;
    const ax = opX(a);
    const bx = opX(b);
    if (ax !== bx) return ax < bx ? -1 : 1;
    const ay = opY(a);
    const by = opY(b);
    return ay === by ? 0 : ay < by ? -1 : 1;
  });
  return { ops: [...body, ...rest] };
}

export function solidJson(solid: Solid): string {
  return canonicalJson(solid as unknown as CanonicalValue);
}

export type Measures = { volume: number; bbox: Bbox; faces: number };

export function measure(solid: Solid): Measures {
  const body = solid.ops.find((op) => op.op === 'box' || op.op === 'cylinder');
  if (!body) return { volume: 0, bbox: [0, 0, 0], faces: 0 };
  let volume: number;
  let bbox: Bbox;
  let faces: number;
  let height: number;
  if (body.op === 'box') {
    volume = body.w * body.d * body.h;
    bbox = [body.w, body.d, body.h];
    faces = 6;
    height = body.h;
  } else {
    const radius = body.dia / 2;
    volume = Math.PI * radius * radius * body.h;
    bbox = [body.dia, body.dia, body.h];
    faces = 3;
    height = body.h;
  }
  let tallestBoss = 0;
  for (const op of solid.ops) {
    switch (op.op) {
      case 'boss': {
        const radius = op.dia / 2;
        volume += Math.PI * radius * radius * op.h;
        faces += 2;
        tallestBoss = Math.max(tallestBoss, op.h);
        break;
      }
      case 'hole': {
        const radius = op.dia / 2;
        volume -= Math.PI * radius * radius * height;
        faces += 1;
        break;
      }
      case 'slot': {
        const radius = op.w / 2;
        volume -= (op.len * op.w + Math.PI * radius * radius) * height;
        faces += 4;
        break;
      }
      default:
        break;
    }
  }
  bbox[2] = height + tallestBoss;
  return { volume, bbox, faces };
}

/** A cut's centre line (a point for holes and bosses, a segment for slots) and radius. */
export type CentreLine = { ax: number; ay: number; bx: number; by: number; radius: number };

export function centreLine(op: SolidOp): CentreLine | null {
  switch (op.op) {
    case 'hole':
    case 'boss':
      return { ax: op.x, ay: op.y, bx: op.x, by: op.y, radius: op.dia / 2 };
    case 'slot':
      return {
        ax: op.x - op.len / 2,
        ay: op.y,
        bx: op.x + op.len / 2,
        by: op.y,
        radius: op.w / 2,
      };
    default:
      return null;
  }
}

function segmentDistance(a: CentreLine, b: CentreLine): number {
  const points: [number, number][] = [
    [a.ax, a.ay],
    [a.bx, a.by],
  ];
  const others: [number, number][] = [
    [b.ax, b.ay],
    [b.bx, b.by],
  ];
  let best = Infinity;
  for (const point of points) best = Math.min(best, pointToSegment(point, others[0], others[1]));
  for (const point of others) best = Math.min(best, pointToSegment(point, points[0], points[1]));
  return best;
}

function pointToSegment(
  point: [number, number],
  start: [number, number],
  end: [number, number],
): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  let t = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
}

/** The smallest distance from a cut's edge to the body's outer edge. */
export function outerWall(line: CentreLine, body: SolidOp): number {
  if (body.op === 'box') {
    const farX = Math.max(Math.abs(line.ax), Math.abs(line.bx));
    const farY = Math.max(Math.abs(line.ay), Math.abs(line.by));
    return Math.min(body.w / 2 - farX - line.radius, body.d / 2 - farY - line.radius);
  }
  if (body.op === 'cylinder') {
    const far = Math.max(Math.hypot(line.ax, line.ay), Math.hypot(line.bx, line.by));
    return body.dia / 2 - far - line.radius;
  }
  return Infinity;
}

/** The distance between two cuts' edges. */
export function cutGap(a: CentreLine, b: CentreLine): number {
  return segmentDistance(a, b) - a.radius - b.radius;
}
