// TRIM and EXTEND of lines, arcs and circles against cutting edges and boundaries.
import * as copy from '../copy.ts';
import type { ArcEntity, CircleEntity, Entity, LineEntity, Point } from '../types.ts';
import { type Prim, arcEnds, arcSweep, ccwDelta, intersections, lineParameter, pointOnLine } from './curves.ts';
import { type ModifyResult, type Refusal, inheriting } from './modify.ts';
import { RAD, TOL, clamp, directionDeg, distance, normalizeAngle, round6 } from './numbers.ts';
import { outlinePrims } from './prims.ts';
import { changedFields, lineEnds, withEnds } from './transform.ts';

/** Sorted parameters closer together than this (in length units) are one crossing. */
const cutsApart = (cuts: number[], scale: number): number[] => cuts.filter((cut, i) => i === 0 || (cut - cuts[i - 1]) * scale > TOL);

function cuttingPrims(edges: readonly Entity[], target: Entity): Prim[] {
  return edges.filter((e) => e.handle !== target.handle).flatMap(outlinePrims);
}

function trimLine(line: LineEntity, pick: Point, cutters: readonly Prim[]): ModifyResult | Refusal {
  const [a, b] = lineEnds(line);
  const length = distance(a, b);
  const own: Prim = { kind: 'segment', a, b };
  const cuts = cutsApart(
    cutters.flatMap((cutter) => intersections(own, cutter)).map((p) => lineParameter(a, b, p)).filter((t) => t * length > TOL && (1 - t) * length > TOL).sort((x, y) => x - y),
    length,
  );
  if (cuts.length === 0) return { refused: copy.TRIM_NOTHING };
  const bounds = [0, ...cuts, 1];
  const picked = clamp(lineParameter(a, b, pick), 0, 1);
  const removed = bounds.findIndex((t, i) => i < bounds.length - 1 && picked >= t && picked <= bounds[i + 1]);
  const pieces = bounds.slice(0, -1).map((t, i): [Point, Point] => [pointOnLine(a, b, t), pointOnLine(a, b, bounds[i + 1])]).filter((_, i) => i !== removed);
  const [kept, ...rest] = pieces;
  return {
    modified: [{ handle: line.handle, set: changedFields(line, withEnds(line, kept[0], kept[1])) }],
    added: rest.map(([p, q]) => inheriting(line, { type: 'line', x1: round6(p[0]), y1: round6(p[1]), x2: round6(q[0]), y2: round6(q[1]) })),
    removed: [],
  };
}

function arcShape(source: ArcEntity | CircleEntity, start: number, end: number): { type: 'arc'; cx: number; cy: number; r: number; start: number; end: number } {
  return { type: 'arc', cx: source.cx, cy: source.cy, r: source.r, start: round6(normalizeAngle(start)), end: round6(normalizeAngle(end)) };
}

function trimArc(arc: ArcEntity, pick: Point, cutters: readonly Prim[]): ModifyResult | Refusal {
  const own: Prim = { kind: 'arc', c: [arc.cx, arc.cy], r: arc.r, start: arc.start, end: arc.end };
  const sweep = arcSweep(arc.start, arc.end);
  const angularTol = TOL / arc.r / RAD;
  const cuts = cutsApart(
    cutters.flatMap((cutter) => intersections(own, cutter)).map((p) => ccwDelta(arc.start, directionDeg([arc.cx, arc.cy], p))).filter((d) => d > angularTol && sweep - d > angularTol).sort((x, y) => x - y),
    arc.r * RAD,
  );
  if (cuts.length === 0) return { refused: copy.TRIM_NOTHING };
  const bounds = [0, ...cuts, sweep];
  const raw = ccwDelta(arc.start, directionDeg([arc.cx, arc.cy], pick));
  const picked = raw <= sweep ? raw : 360 - raw < raw - sweep ? 0 : sweep;
  const removed = bounds.findIndex((t, i) => i < bounds.length - 1 && picked >= t && picked <= bounds[i + 1]);
  const pieces = bounds.slice(0, -1).map((t, i): [number, number] => [arc.start + t, arc.start + bounds[i + 1]]).filter((_, i) => i !== removed);
  const [kept, ...rest] = pieces;
  return {
    modified: [{ handle: arc.handle, set: changedFields(arc, { ...arc, ...arcShape(arc, kept[0], kept[1]) }) }],
    added: rest.map(([s, e]) => inheriting(arc, arcShape(arc, s, e))),
    removed: [],
  };
}

function trimCircle(circle: CircleEntity, pick: Point, cutters: readonly Prim[]): ModifyResult | Refusal {
  const own: Prim = { kind: 'circle', c: [circle.cx, circle.cy], r: circle.r };
  const angularTol = TOL / circle.r / RAD;
  const cuts = cutsApart(
    cutters.flatMap((cutter) => intersections(own, cutter)).map((p) => directionDeg([circle.cx, circle.cy], p)).sort((x, y) => x - y),
    circle.r * RAD,
  );
  const distinct = cuts.length > 1 && 360 - cuts[cuts.length - 1] + cuts[0] <= angularTol ? cuts.slice(0, -1) : cuts;
  if (distinct.length < 2) return { refused: copy.TRIM_NOTHING };
  const at = directionDeg([circle.cx, circle.cy], pick);
  const before = [...distinct].reverse().find((cut) => cut <= at) ?? distinct[distinct.length - 1];
  const after = distinct.find((cut) => cut > at) ?? distinct[0];
  return { modified: [], added: [inheriting(circle, arcShape(circle, after, before))], removed: [circle.handle]};
}

/** TRIM: split `target` (line, arc or circle) at every crossing with `edges`, remove the piece holding `pick`. A circle is replaced by an arc. */
export function trim(target: Entity, pick: Point, edges: readonly Entity[]): ModifyResult | Refusal {
  const cutters = cuttingPrims(edges, target);
  switch (target.type) {
    case 'line':
      return trimLine(target, pick, cutters);
    case 'arc':
      return trimArc(target, pick, cutters);
    case 'circle':
      return trimCircle(target, pick, cutters);
    default:
      return { refused: copy.TRIM_WRONG_TYPE };
  }
}

const REACH = 1e7;

function extendLine(line: LineEntity, pick: Point, boundaries: readonly Prim[]): ModifyResult | Refusal {
  const [a, b] = lineEnds(line);
  const fromStart = distance(pick, a) < distance(pick, b);
  const [anchor, end] = fromStart ? [b, a] : [a, b];
  const length = distance(anchor, end);
  if (length === 0) return { refused: copy.EXTEND_NOTHING };
  const ray: Prim = { kind: 'segment', a: end, b: [end[0] + ((end[0] - anchor[0]) / length) * REACH, end[1] + ((end[1] - anchor[1]) / length) * REACH] };
  const hit = boundaries.flatMap((boundary) => intersections(ray, boundary)).filter((p) => distance(p, end) > TOL).sort((p, q) => distance(p, end) - distance(q, end))[0];
  if (hit === undefined) return { refused: copy.EXTEND_NOTHING };
  const extended = fromStart ? withEnds(line, hit, b) : withEnds(line, a, hit);
  return { modified: [{ handle: line.handle, set: changedFields(line, extended) }], added: [], removed: [] };
}

function extendArc(arc: ArcEntity, pick: Point, boundaries: readonly Prim[]): ModifyResult | Refusal {
  const centre: Point = [arc.cx, arc.cy];
  const [startPoint, endPoint] = arcEnds({ kind: 'arc', c: centre, r: arc.r, start: arc.start, end: arc.end });
  const fromStart = distance(pick, startPoint) < distance(pick, endPoint);
  const angularTol = TOL / arc.r / RAD;
  const room = 360 - arcSweep(arc.start, arc.end);
  const own: Prim = { kind: 'circle', c: centre, r: arc.r };
  const reach = boundaries
    .flatMap((boundary) => intersections(own, boundary))
    .map((p) => directionDeg(centre, p))
    .map((angle) => ({ angle, gap: fromStart ? ccwDelta(angle, arc.start) : ccwDelta(arc.end, angle) }))
    .filter(({ gap }) => gap > angularTol && gap < room + angularTol)
    .sort((x, y) => x.gap - y.gap)[0];
  if (reach === undefined) return { refused: copy.EXTEND_NOTHING };
  const extended: ArcEntity = fromStart ? { ...arc, start: round6(reach.angle) } : { ...arc, end: round6(reach.angle) };
  return { modified: [{ handle: arc.handle, set: changedFields(arc, extended) }], added: [], removed: [] };
}

/** EXTEND: move the end of a line or arc nearest `pick` to the first boundary crossed. */
export function extend(target: Entity, pick: Point, boundaries: readonly Entity[]): ModifyResult | Refusal {
  const prims = cuttingPrims(boundaries, target);
  switch (target.type) {
    case 'line':
      return extendLine(target, pick, prims);
    case 'arc':
      return extendArc(target, pick, prims);
    default:
      return { refused: copy.EXTEND_NOTHING };
  }
}
