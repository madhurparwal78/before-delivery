// FILLET and CHAMFER of two lines.
import * as copy from '../copy.ts';
import type { LineEntity, Point } from '../types.ts';
import { ccwDelta, lineCrossing } from './curves.ts';
import { type EntityEdit, type ModifyResult, type Refusal, inheriting } from './modify.ts';
import { TOL, directionDeg, distance, round6 } from './numbers.ts';
import { changedFields, lineEnds, withEnds } from './transform.ts';

/** One line of the pair: the end it keeps and the direction from the crossing to it. */
interface KeptPart { line: LineEntity; far: Point; length: number; direction: Point }

/** The kept part of a line is the side of the crossing `x` holding its pick point: it runs from `x` to the farthest end on that side. */
function keptPart(line: LineEntity, pick: Point, x: Point): KeptPart {
  const ends = lineEnds(line);
  const towardsPick: Point = [pick[0] - x[0], pick[1] - x[1]];
  const onPickSide = ends.filter((end) => (end[0] - x[0]) * towardsPick[0] + (end[1] - x[1]) * towardsPick[1] > 0);
  const candidates = onPickSide.length > 0 ? onPickSide : ends;
  const far = candidates.reduce((a, b) => (distance(a, x) >= distance(b, x) ? a : b));
  const length = distance(far, x);
  return { line, far, length, direction: [(far[0] - x[0]) / length, (far[1] - x[1]) / length] };
}

/** The line with the end opposite `far` moved to `to`. */
function cutBack(part: KeptPart, to: Point): EntityEdit {
  const [start, end] = lineEnds(part.line);
  const keepStart = distance(start, part.far) === 0;
  const a = keepStart ? start : to;
  const b = keepStart ? to : end;
  return { handle: part.line.handle, set: changedFields(part.line, withEnds(part.line, a, b)) };
}

interface Corner { x: Point; first: KeptPart; second: KeptPart; angle: number }

function cornerOf(first: LineEntity, firstPick: Point, second: LineEntity, secondPick: Point): Corner | null {
  const crossing = lineCrossing(...lineEnds(first), ...lineEnds(second));
  if (crossing === null) return null;
  const a = keptPart(first, firstPick, crossing.point);
  const b = keptPart(second, secondPick, crossing.point);
  return { x: crossing.point, first: a, second: b, angle: Math.acos(Math.max(-1, Math.min(1, a.direction[0] * b.direction[0] + a.direction[1] * b.direction[1]))) };
}

const along = (x: Point, part: KeptPart, d: number): Point => [x[0] + part.direction[0] * d, x[1] + part.direction[1] * d];

/** FILLET of two lines: tangent points at t = r / tan(theta / 2) from the crossing, joined by a new arc; radius 0 trims or extends to the crossing. */
export function fillet(first: LineEntity, firstPick: Point, second: LineEntity, secondPick: Point, radius: number): ModifyResult | Refusal {
  const corner = cornerOf(first, firstPick, second, secondPick);
  if (corner === null) return { refused: copy.FILLET_PARALLEL };
  const { x, first: a, second: b, angle } = corner;
  if (radius === 0) return { modified: [cutBack(a, x), cutBack(b, x)], added: [], removed: [] };
  const t = radius / Math.tan(angle / 2);
  if (t > a.length + TOL || t > b.length + TOL) return { refused: copy.FILLET_TOO_LARGE };
  const t1 = along(x, a, t);
  const t2 = along(x, b, t);
  const bisector: Point = [a.direction[0] + b.direction[0], a.direction[1] + b.direction[1]];
  const reach = radius / Math.sin(angle / 2) / Math.hypot(bisector[0], bisector[1]);
  const centre: Point = [x[0] + bisector[0] * reach, x[1] + bisector[1] * reach];
  const [a1, a2] = [directionDeg(centre, t1), directionDeg(centre, t2)];
  const [start, end] = ccwDelta(a1, a2) <= 180 ? [a1, a2] : [a2, a1];
  return {
    modified: [cutBack(a, t1), cutBack(b, t2)],
    added: [inheriting(first, { type: 'arc', cx: round6(centre[0]), cy: round6(centre[1]), r: round6(radius), start: round6(start), end: round6(end) })],
    removed: [],
  };
}

/** CHAMFER of two lines: cut the kept parts back to d1 and d2 from the crossing and join with a new line (0 and 0 acts as fillet radius 0). */
export function chamfer(first: LineEntity, firstPick: Point, second: LineEntity, secondPick: Point, distance1: number, distance2: number): ModifyResult | Refusal {
  const corner = cornerOf(first, firstPick, second, secondPick);
  if (corner === null) return { refused: copy.CHAMFER_PARALLEL };
  const { x, first: a, second: b } = corner;
  if (distance1 > a.length + TOL || distance2 > b.length + TOL) return { refused: copy.CHAMFER_TOO_LARGE };
  const p1 = along(x, a, distance1);
  const p2 = along(x, b, distance2);
  const modified = [cutBack(a, p1), cutBack(b, p2)];
  if (distance(p1, p2) <= TOL) return { modified, added: [], removed: [] };
  return {
    modified,
    added: [inheriting(first, { type: 'line', x1: round6(p1[0]), y1: round6(p1[1]), x2: round6(p2[0]), y2: round6(p2[1]) })],
    removed: [],
  };
}
