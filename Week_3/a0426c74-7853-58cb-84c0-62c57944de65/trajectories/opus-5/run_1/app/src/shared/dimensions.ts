import { TOLERANCE, fmtPrecision, round6 } from './numbers.js';
import type { DimensionEntity, DimRef, DrawingModel, Entity } from './model.js';
import { findEntity, findStyle } from './model.js';
import { type Vec, angleBetween, dist, lineOf, namedPoints, sub, vec } from './geometry.js';

/** The entity point a dimension point links to, within 0.001 of a start, end or centre. */
export function linkFor(model: DrawingModel, point: Vec, skip: string[] = []): DimRef | null {
  for (const entity of model.entities) {
    if (skip.includes(entity.handle)) continue;
    for (const named of namedPoints(entity)) {
      if (dist(named.at, point) <= TOLERANCE) return { handle: entity.handle, point: named.point };
    }
  }
  return null;
}

function refPoint(model: DrawingModel, ref: DimRef | undefined, fallback: Vec): Vec | null {
  if (!ref) return fallback;
  const entity = findEntity(model, ref.handle);
  if (!entity) return null;
  if (ref.point === null) return fallback;
  const named = namedPoints(entity).find((candidate) => candidate.point === ref.point);
  return named ? named.at : fallback;
}

export function dimensionPoints(model: DrawingModel, dimension: DimensionEntity): Vec[] | null {
  const out: Vec[] = [];
  for (let index = 0; index < Math.max(dimension.points.length, dimension.refs.length); index += 1) {
    const stored = dimension.points[index];
    const fallback = stored ? vec(stored[0], stored[1]) : vec(dimension.text_x, dimension.text_y);
    const point = refPoint(model, dimension.refs[index], fallback);
    if (point === null) return null;
    out.push(point);
  }
  return out;
}

export function dimensionIsAssociative(model: DrawingModel, dimension: DimensionEntity): boolean {
  if (dimension.refs.length === 0) return false;
  return dimension.refs.every((ref) => findEntity(model, ref.handle) !== undefined);
}

function angularValue(model: DrawingModel, dimension: DimensionEntity): number | null {
  const first = dimension.refs[0] ? findEntity(model, dimension.refs[0].handle) : undefined;
  const second = dimension.refs[1] ? findEntity(model, dimension.refs[1].handle) : undefined;
  const a = lineOf(first as Entity);
  const b = lineOf(second as Entity);
  if (!a || !b) return null;
  const angle = angleBetween(sub(a.b, a.a), sub(b.b, b.a));
  return Math.min(angle, 180 - angle);
}

function radialValue(model: DrawingModel, dimension: DimensionEntity): number | null {
  const ref = dimension.refs[0];
  const entity = ref ? findEntity(model, ref.handle) : undefined;
  if (!entity || (entity.type !== 'circle' && entity.type !== 'arc')) return null;
  return entity.r;
}

/** The raw value of a dimension over current geometry, before the style scale. */
export function rawDimensionValue(model: DrawingModel, dimension: DimensionEntity): number | null {
  if (dimension.kind === 'angular') return angularValue(model, dimension);
  if (dimension.kind === 'radial') return radialValue(model, dimension);
  const points = dimensionPoints(model, dimension);
  if (!points || points.length < 2) return null;
  const [first, second] = points;
  if (dimension.kind === 'aligned') return dist(first, second);
  const dx = Math.abs(second.x - first.x);
  const dy = Math.abs(second.y - first.y);
  return dx >= dy ? dx : dy;
}

/** Recompute a dimension against current geometry, keeping its last value when its link is gone. */
export function refreshDimension(model: DrawingModel, dimension: DimensionEntity): void {
  const associative = dimensionIsAssociative(model, dimension);
  dimension.associative = associative;
  if (!associative) return;
  const raw = rawDimensionValue(model, dimension);
  if (raw === null) {
    dimension.associative = false;
    return;
  }
  const style = findStyle(model, dimension.style);
  dimension.value = round6(raw * style.scale);
  const points = dimensionPoints(model, dimension);
  if (points && points.length === dimension.points.length) {
    dimension.points = points.map((point) => [round6(point.x), round6(point.y)] as [number, number]);
  }
}

export function dimensionValueText(model: DrawingModel, dimension: DimensionEntity): string {
  const style = findStyle(model, dimension.style);
  return fmtPrecision(dimension.value, style.precision);
}

/** The visible text: prefix + value + suffix, or the override with <> standing for it. */
export function dimensionText(model: DrawingModel, dimension: DimensionEntity): string {
  const style = findStyle(model, dimension.style);
  const plain = `${style.prefix}${dimensionValueText(model, dimension)}${style.suffix}`;
  if (dimension.override === null || dimension.override === '') return plain;
  return dimension.override.replace(/<>/g, plain);
}
