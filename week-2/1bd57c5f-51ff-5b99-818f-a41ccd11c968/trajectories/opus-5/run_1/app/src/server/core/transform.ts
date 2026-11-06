import { roundHalfUp } from './decimal.js';
import { PLAN_UNITS, type UPoint } from './geometry.js';

export type ReferencePair = { old: UPoint; new: UPoint };

/**
 * The affine map solved exactly from three reference pairs, held in barycentric form so
 * that no binary floating point ever touches a pin coordinate.
 */
export type PlanTransform = {
  readonly old: readonly [UPoint, UPoint, UPoint];
  readonly next: readonly [UPoint, UPoint, UPoint];
  readonly det: bigint;
};

/** Twice the triangle area, in units of 1/100000000, as an exact integer. */
export function twiceArea(points: readonly [UPoint, UPoint, UPoint]): bigint {
  const [p1, p2, p3] = points;
  const ax = BigInt(p2.x - p1.x);
  const ay = BigInt(p2.y - p1.y);
  const bx = BigInt(p3.x - p1.x);
  const by = BigInt(p3.y - p1.y);
  return ax * by - bx * ay;
}

/** The collinearity bound of 0.000001 expressed in the integer units of twiceArea. */
export const COLLINEAR_LIMIT = 100n;

export function isCollinear(points: readonly [UPoint, UPoint, UPoint]): boolean {
  const area = twiceArea(points);
  return (area < 0n ? -area : area) < COLLINEAR_LIMIT;
}

export function makeTransform(pairs: readonly ReferencePair[]): PlanTransform | null {
  if (pairs.length !== 3) return null;
  const old = [pairs[0].old, pairs[1].old, pairs[2].old] as const;
  if (isCollinear(old)) return null;
  return {
    old,
    next: [pairs[0].new, pairs[1].new, pairs[2].new] as const,
    det: twiceArea(old),
  };
}

export const IDENTITY_TRANSFORM: PlanTransform = makeTransform([
  { old: { x: 0, y: 0 }, new: { x: 0, y: 0 } },
  { old: { x: PLAN_UNITS, y: 0 }, new: { x: PLAN_UNITS, y: 0 } },
  { old: { x: 0, y: PLAN_UNITS }, new: { x: 0, y: PLAN_UNITS } },
])!;

function cross(ax: bigint, ay: bigint, bx: bigint, by: bigint): bigint {
  return ax * by - bx * ay;
}

/**
 * Maps a pin through the transform and rounds each coordinate to 1/10000, halves up.
 * The result may fall outside 0..1; the caller decides what that means.
 */
export function applyTransform(transform: PlanTransform, point: UPoint): UPoint {
  const [p1, p2, p3] = transform.old;
  const [q1, q2, q3] = transform.next;
  const px = BigInt(point.x);
  const py = BigInt(point.y);
  const l1 = cross(BigInt(p2.x) - px, BigInt(p2.y) - py, BigInt(p3.x) - px, BigInt(p3.y) - py);
  const l2 = cross(BigInt(p3.x) - px, BigInt(p3.y) - py, BigInt(p1.x) - px, BigInt(p1.y) - py);
  const l3 = cross(BigInt(p1.x) - px, BigInt(p1.y) - py, BigInt(p2.x) - px, BigInt(p2.y) - py);
  let den = transform.det;
  let nx = l1 * BigInt(q1.x) + l2 * BigInt(q2.x) + l3 * BigInt(q3.x);
  let ny = l1 * BigInt(q1.y) + l2 * BigInt(q2.y) + l3 * BigInt(q3.y);
  if (den < 0n) {
    den = -den;
    nx = -nx;
    ny = -ny;
  }
  return { x: Number(roundHalfUp(nx, den)), y: Number(roundHalfUp(ny, den)) };
}

export function withinPlan(point: UPoint): boolean {
  return point.x >= 0 && point.x <= PLAN_UNITS && point.y >= 0 && point.y <= PLAN_UNITS;
}
