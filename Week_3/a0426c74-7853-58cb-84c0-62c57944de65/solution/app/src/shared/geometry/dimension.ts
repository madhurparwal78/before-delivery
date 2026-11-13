// Associative dimensions: link points, values, text and the drawn layout (extension lines, dimension line, arc, arrows, text position).
import type { DimRef, DimStyle, DimensionEntity, Entity, Point } from '../types.ts';
import { ccwDelta, lineCrossing } from './curves.ts';
import { RAD, TOL, compareHandles, directionDeg, distance, fmtFixed, normalizeAngle, pointAtAngle } from './numbers.ts';
import { lineEnds } from './transform.ts';

export type EntityLookup = (handle: string) => Entity | undefined;

/** The dimension style `Standard`: precision 2, no prefix or suffix, scale 1, text height 2.5 mm. */
export const STANDARD_DIM_STYLE: DimStyle = { name: 'Standard', precision: 2, prefix: '', suffix: '', scale: 1, text_height_mm: 2.5 };

/** The style by name, `Standard` when the name is unknown. */
export function dimensionStyle(styles: Readonly<Record<string, DimStyle>>, name: string): DimStyle {
  return styles[name] ?? STANDARD_DIM_STYLE;
}

/** The point of an entity a dimension ref names (`start`, `end`, `centre`); null when the entity has no such point. */
function entityPoint(entity: Entity, point: DimRef['point']): Point | null {
  switch (entity.type) {
    case 'line':
      return point === 'start' ? [entity.x1, entity.y1] : point === 'end' ? [entity.x2, entity.y2] : null;
    case 'arc':
      if (point === 'centre') return [entity.cx, entity.cy];
      if (point === 'start') return pointAtAngle([entity.cx, entity.cy], entity.r, entity.start);
      return point === 'end' ? pointAtAngle([entity.cx, entity.cy], entity.r, entity.end) : null;
    case 'circle':
      return point === 'centre' ? [entity.cx, entity.cy] : null;
    case 'pline': {
      const first = entity.points[0];
      const last = entity.points[entity.points.length - 1];
      return point === 'start' ? (first ?? null) : point === 'end' ? (last ?? null) : null;
    }
    case 'insert':
      return point === 'start' ? [entity.x, entity.y] : null;
    case 'hatch':
    case 'dimension':
      return null;
  }
}

const LINK_POINTS = ['start', 'end', 'centre'] as const;

/** The dimension point that lies within 0.001 of an entity's start, end or centre links to that entity point; else null. */
export function linkDimensionPoint(entities: Readonly<Record<string, Entity>>, point: Point): DimRef | null {
  let best: { ref: DimRef; gap: number } | null = null;
  for (const entity of Object.values(entities)) {
    for (const name of LINK_POINTS) {
      const p = entityPoint(entity, name);
      if (p === null) continue;
      const gap = distance(p, point);
      if (gap > TOL) continue;
      const closer = best === null || gap < best.gap - 1e-12 || (Math.abs(gap - best.gap) <= 1e-12 && compareHandles(entity.handle, best.ref.handle) < 0);
      if (closer) best = { ref: { handle: entity.handle, point: name }, gap };
    }
  }
  return best === null ? null : best.ref;
}

function refPoint(ref: DimRef, lookup: EntityLookup): Point | null {
  const entity = lookup(ref.handle);
  return entity === undefined ? null : entityPoint(entity, ref.point);
}

type Line = Extract<Entity, { type: 'line' }>;

function lineAt(lookup: EntityLookup, ref: DimRef | undefined): Line | null {
  const entity = ref === undefined ? undefined : lookup(ref.handle);
  return entity?.type === 'line' ? entity : null;
}

const lineAngle = (line: Line): number => directionDeg(...lineEnds(line));

function measuredValue(dimension: Pick<DimensionEntity, 'kind' | 'refs'>, lookup: EntityLookup): number | null {
  const [first, second] = dimension.refs;
  if (first === undefined) return null;
  switch (dimension.kind) {
    case 'linear':
    case 'aligned': {
      const a = refPoint(first, lookup);
      const b = second === undefined ? null : refPoint(second, lookup);
      if (a === null || b === null) return null;
      const dx = Math.abs(b[0] - a[0]);
      const dy = Math.abs(b[1] - a[1]);
      if (dimension.kind === 'aligned') return distance(a, b);
      return dx >= dy ? dx : dy;
    }
    case 'angular': {
      const one = lineAt(lookup, first);
      const two = lineAt(lookup, second);
      if (one === null || two === null) return null;
      const between = 180 - Math.abs(ccwDelta(lineAngle(two), lineAngle(one)) - 180);
      return Math.min(between, 180 - between);
    }
    case 'radial': {
      const target = lookup(first.handle);
      return target !== undefined && (target.type === 'circle' || target.type === 'arc') ? target.r : null;
    }
  }
}

/** The scaled value (not rounded) over current geometry; null when a ref no longer resolves. */
function dimensionValueOf(dimension: Pick<DimensionEntity, 'kind' | 'refs'>, lookup: EntityLookup, style: DimStyle): number | null {
  const value = measuredValue(dimension, lookup);
  return value === null ? null : value * style.scale;
}

export function dimensionValue(dimension: Pick<DimensionEntity, 'kind' | 'refs'>, entities: Readonly<Record<string, Entity>>, style: DimStyle): number | null {
  return dimensionValueOf(dimension, (handle) => entities[handle], style);
}

/** `data-value`: the stored value at the style's precision, trailing zeros kept. */
export function dimensionDataValue(dimension: Pick<DimensionEntity, 'value'>, style: DimStyle): string {
  return fmtFixed(dimension.value, style.precision);
}

/** Visible text: prefix + value + suffix; an override replaces it with `<>` standing for that text. */
export function dimensionText(dimension: Pick<DimensionEntity, 'value' | 'override'>, style: DimStyle): string {
  const text = `${style.prefix}${dimensionDataValue(dimension, style)}${style.suffix}`;
  return dimension.override === null ? text : dimension.override.replaceAll('<>', text);
}

interface DimensionArrow {
  tip: Point;
  /** unit direction in which the arrow's body extends from its tip */
  along: Point;
}

export interface DimensionLayout {
  /** extension lines and the dimension line */
  segments: [Point, Point][];
  /** the arc of an angular dimension */
  arc: { c: Point; r: number; start: number; end: number } | null;
  arrows: DimensionArrow[];
  text: Point;
  /** text rotation in degrees, readable from the bottom or right */
  textAngle: number;
}

function unit(from: Point, to: Point): Point {
  const d = distance(from, to);
  return d === 0 ? [1, 0] : [(to[0] - from[0]) / d, (to[1] - from[1]) / d];
}

function readable(angle: number): number {
  const turned = normalizeAngle(angle);
  return turned > 90 && turned <= 270 ? turned - 180 : turned;
}

function dimensionLineArrows(a: Point, b: Point): DimensionArrow[] {
  return [{ tip: a, along: unit(a, b) }, { tip: b, along: unit(b, a) }];
}

function spanLayout(a: Point, b: Point, a2: Point, b2: Point, text: Point, textAngle: number): DimensionLayout {
  return { segments: [[a, a2], [b, b2], [a2, b2]], arc: null, arrows: dimensionLineArrows(a2, b2), text, textAngle };
}

/** The drawn parts of a dimension over current geometry; null when its geometry is gone (only the stored text position remains). */
export function dimensionLayout(dimension: DimensionEntity, lookup: EntityLookup): DimensionLayout | null {
  const text: Point = [dimension.text_x, dimension.text_y];
  const [first, second] = dimension.refs;
  if (first === undefined) return null;
  switch (dimension.kind) {
    case 'linear':
    case 'aligned': {
      const a = refPoint(first, lookup);
      const b = second === undefined ? null : refPoint(second, lookup);
      if (a === null || b === null) return null;
      if (dimension.kind === 'linear' && Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1])) {
        return spanLayout(a, b, [a[0], text[1]], [b[0], text[1]], text, 0);
      }
      if (dimension.kind === 'linear') return spanLayout(a, b, [text[0], a[1]], [text[0], b[1]], text, 90);
      const u = unit(a, b);
      const offset = (text[0] - a[0]) * -u[1] + (text[1] - a[1]) * u[0];
      const shift: Point = [-u[1] * offset, u[0] * offset];
      return spanLayout(a, b, [a[0] + shift[0], a[1] + shift[1]], [b[0] + shift[0], b[1] + shift[1]], text, readable(directionDeg(a, b)));
    }
    case 'angular': {
      const one = lineAt(lookup, first);
      const two = lineAt(lookup, second);
      if (one === null || two === null) return null;
      const crossing = lineCrossing(...lineEnds(one), ...lineEnds(two));
      if (crossing === null) return null;
      const vertex = crossing.point;
      const rays = [lineAngle(one), lineAngle(one) + 180, lineAngle(two), lineAngle(two) + 180].map(normalizeAngle).sort((x, y) => x - y);
      const towardText = directionDeg(vertex, text);
      const start = [...rays].reverse().find((ray) => ray <= towardText) ?? rays[rays.length - 1];
      const end = rays.find((ray) => ray > start) ?? rays[0];
      const radius = distance(vertex, text);
      const arc = { c: vertex, r: radius, start, end };
      const startPoint = pointAtAngle(vertex, radius, start);
      const endPoint = pointAtAngle(vertex, radius, end);
      const tangent = (angle: number, sign: number): Point => [-Math.sin(angle * RAD) * sign, Math.cos(angle * RAD) * sign];
      return {
        segments: [], arc, text, textAngle: 0,
        arrows: [{ tip: startPoint, along: tangent(start, 1) }, { tip: endPoint, along: tangent(end, -1) }],
      };
    }
    case 'radial': {
      const target = lookup(first.handle);
      if (target === undefined || (target.type !== 'circle' && target.type !== 'arc')) return null;
      const centre: Point = [target.cx, target.cy];
      const angle = directionDeg(centre, text);
      const edge = pointAtAngle(centre, target.r, angle);
      const reach: Point = distance(centre, text) > target.r ? text : edge;
      return { segments: [[centre, reach]], arc: null, arrows: [{ tip: edge, along: unit(edge, centre) }], text, textAngle: readable(angle) };
    }
  }
}
