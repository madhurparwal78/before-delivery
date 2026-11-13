import type { ConstraintKind, Entity, Point2, Sketch } from '../../shared/api';

export interface View {
  /** Screen pixels per millimetre. */
  scale: number;
  /** Screen position of the sketch origin. */
  ox: number;
  oy: number;
}

export const toScreen = (view: View, p: Point2): Point2 => ({ x: view.ox + p.x * view.scale, y: view.oy - p.y * view.scale });
export const toWorld = (view: View, p: Point2): Point2 => ({ x: (p.x - view.ox) / view.scale, y: (view.oy - p.y) / view.scale });

/** Position of a point reference in the sketch: "origin", an entity id, or "<id>.start|end|center". */
function pointAt(sketch: Sketch, ref: string): Point2 | undefined {
  if (ref === 'origin') return { x: 0, y: 0 };
  const hit = sketch.points.find((p) => p.ref === ref);
  return hit && { x: hit.x, y: hit.y };
}

export const entityById = (sketch: Sketch, id: string): Entity | undefined => sketch.entities.find((e) => e.id === id);

/** Smallest box around everything drawn, always including the origin. */
export function sketchBounds(sketch: Sketch): { min: Point2; max: Point2 } {
  const xs = [0];
  const ys = [0];
  for (const e of sketch.entities) {
    if (e.type === 'point') (xs.push(e.x), ys.push(e.y));
    if (e.type === 'line') (xs.push(e.start.x, e.end.x), ys.push(e.start.y, e.end.y));
    if (e.type === 'circle' || e.type === 'arc') {
      xs.push(e.center.x - e.radius, e.center.x + e.radius);
      ys.push(e.center.y - e.radius, e.center.y + e.radius);
    }
  }
  return { min: { x: Math.min(...xs), y: Math.min(...ys) }, max: { x: Math.max(...xs), y: Math.max(...ys) } };
}

/** The value a dimension would have if applied now (millimetres). */
export function measure(sketch: Sketch, kind: ConstraintKind, refs: readonly string[]): number | undefined {
  const [a, b] = refs;
  const first = a ? entityById(sketch, a) : undefined;
  if (kind === 'diameter' || kind === 'radius') {
    if (first?.type !== 'circle' && first?.type !== 'arc') return undefined;
    return kind === 'diameter' ? 2 * first.radius : first.radius;
  }
  if (kind === 'distance' && first?.type === 'line') return Math.hypot(first.end.x - first.start.x, first.end.y - first.start.y);
  const p = a ? pointAt(sketch, a) : undefined;
  const q = b ? pointAt(sketch, b) : undefined;
  if (!p || !q) return undefined;
  if (kind === 'horizontal_distance') return Math.abs(q.x - p.x);
  if (kind === 'vertical_distance') return Math.abs(q.y - p.y);
  return Math.hypot(q.x - p.x, q.y - p.y);
}

/** Where a constraint's glyph sits on the canvas, in sketch millimetres, and which way "outwards" points. */
export function glyphAnchor(sketch: Sketch, kind: ConstraintKind, refs: readonly string[]): Point2 {
  const points = refs.map((r) => pointAt(sketch, r)).filter((p): p is Point2 => p !== undefined);
  const lines = refs.map((r) => entityById(sketch, r)).filter((e): e is Extract<Entity, { type: 'line' }> => e?.type === 'line');
  const round = refs.map((r) => entityById(sketch, r)).find((e) => e?.type === 'circle' || e?.type === 'arc');
  if (round && (round.type === 'circle' || round.type === 'arc')) return { x: round.center.x + round.radius * 0.7071, y: round.center.y + round.radius * 0.7071 };
  if (lines.length > 0 && kind !== 'coincident') {
    const mids = lines.map((l) => ({ x: (l.start.x + l.end.x) / 2, y: (l.start.y + l.end.y) / 2 }));
    return { x: mids.reduce((s, m) => s + m.x, 0) / mids.length, y: mids.reduce((s, m) => s + m.y, 0) / mids.length };
  }
  if (points.length === 0) return { x: 0, y: 0 };
  return { x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length };
}

/** A fresh line beside the last entity: 20 mm horizontal, ten millimetres to its right. */
export function suggestedLine(sketch: Sketch): { start: Point2; end: Point2 } {
  const { max, min } = sketchBounds(sketch);
  const last = sketch.entities[sketch.entities.length - 1];
  const y = last ? (min.y + max.y) / 2 : 0;
  const x = last ? max.x + 10 : 0;
  return { start: { x, y }, end: { x: x + 20, y } };
}
