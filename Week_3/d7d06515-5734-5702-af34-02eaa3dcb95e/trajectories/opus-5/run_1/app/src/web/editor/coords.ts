import type { Point } from '../../shared/api';
import { lengthToMillimetres, type Units } from '../../shared/format';

const NUMBER = /^-?\d+(?:\.\d+)?$/;

export function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  return NUMBER.test(trimmed) ? Number.parseFloat(trimmed) : null;
}

export type TypedPoint =
  | { kind: 'absolute'; x: number; y: number }
  | { kind: 'relative'; dx: number; dy: number }
  | { kind: 'polar'; distance: number; angle: number };

/** Absolute `x,y`, relative `@dx,dy` and polar `@d<a`, each number in the drawing's units. */
export function parseTypedPoint(text: string): TypedPoint | null {
  const trimmed = text.trim();
  if (trimmed.startsWith('@')) {
    const rest = trimmed.slice(1);
    if (rest.includes('<')) {
      const [distance, angle] = rest.split('<');
      const d = parseNumber(distance ?? '');
      const a = parseNumber(angle ?? '');
      if (d === null || a === null) return null;
      return { kind: 'polar', distance: d, angle: a };
    }
    const [dx, dy] = rest.split(',');
    const x = parseNumber(dx ?? '');
    const y = parseNumber(dy ?? '');
    if (x === null || y === null) return null;
    return { kind: 'relative', dx: x, dy: y };
  }
  const [xs, ys] = trimmed.split(',');
  if (ys === undefined) return null;
  const x = parseNumber(xs ?? '');
  const y = parseNumber(ys);
  if (x === null || y === null) return null;
  return { kind: 'absolute', x, y };
}

export function resolveTypedPoint(typed: TypedPoint, last: Point | null, units: Units): Point | null {
  if (typed.kind === 'absolute') {
    return [lengthToMillimetres(typed.x, units), lengthToMillimetres(typed.y, units)];
  }
  if (last === null) return null;
  if (typed.kind === 'relative') {
    return [last[0] + lengthToMillimetres(typed.dx, units), last[1] + lengthToMillimetres(typed.dy, units)];
  }
  const distance = lengthToMillimetres(typed.distance, units);
  const radians = (typed.angle * Math.PI) / 180;
  return [last[0] + distance * Math.cos(radians), last[1] + distance * Math.sin(radians)];
}

export function parseHandleReference(text: string): string | null {
  const trimmed = text.trim();
  return trimmed.startsWith('#') && trimmed.length > 1 ? trimmed.slice(1).toUpperCase() : null;
}

/** ORTHO puts a point on the axis of the larger delta through the last point. */
export function applyOrtho(point: Point, last: Point): Point {
  const dx = point[0] - last[0];
  const dy = point[1] - last[1];
  return Math.abs(dx) >= Math.abs(dy) ? [point[0], last[1]] : [last[0], point[1]];
}

/** POLAR snaps the direction to the nearest 45 degree increment, keeping the distance. */
export function applyPolar(point: Point, last: Point): Point {
  const dx = point[0] - last[0];
  const dy = point[1] - last[1];
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return point;
  const angle = Math.atan2(dy, dx);
  const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  return [last[0] + distance * Math.cos(snapped), last[1] + distance * Math.sin(snapped)];
}

export const GRID_STEP = 100;

export function applyGrid(point: Point): Point {
  return [Math.round(point[0] / GRID_STEP) * GRID_STEP, Math.round(point[1] / GRID_STEP) * GRID_STEP];
}
