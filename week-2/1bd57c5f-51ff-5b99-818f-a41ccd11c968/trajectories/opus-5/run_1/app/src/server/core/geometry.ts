import { exactUnits, numberToDecimalString, parseDecimalString, roundDecimalString } from './decimal.js';

/** Plan coordinates are held as integers in units of 1/10000 of the plan image. */
export const PLAN_UNITS = 10000;

export type UPoint = { x: number; y: number };
export type Outline = UPoint[];

export type Bounds = { x: number; y: number; w: number; h: number };

/** Anchor coordinates are exact midpoints, so they live in units of 1/20000. */
export const ANCHOR_UNITS = 20000;
export type Anchor = { x: number; y: number };

export function unitsToFraction(units: number): number {
  return Number((units / PLAN_UNITS).toFixed(4));
}

export function anchorToFraction(units: number): number {
  return Number((units / ANCHOR_UNITS).toFixed(5));
}

/** Reads a plan coordinate that must carry at most four decimals and sit within 0 and 1. */
export function readExactCoordinate(value: unknown): number | null {
  if (typeof value !== 'number') return null;
  const text = numberToDecimalString(value);
  if (text === null) return null;
  const units = exactUnits(text, 4);
  if (units === null) return null;
  if (units < 0n || units > BigInt(PLAN_UNITS)) return null;
  return Number(units);
}

/** Rounds a pin coordinate to the nearest 1/10000, halves up. Values outside 0..1 are refused. */
export function readPinCoordinate(value: unknown): number | null {
  if (typeof value !== 'number') return null;
  const text = numberToDecimalString(value);
  if (text === null) return null;
  const parsed = parseDecimalString(text);
  if (parsed === null || parsed.sign === -1) return null;
  const whole = Number(parsed.intPart);
  if (whole > 1 || (whole === 1 && /[1-9]/.test(parsed.fracPart))) return null;
  const units = roundDecimalString(text, 4);
  if (units === null) return null;
  return Number(units);
}

export type OutlineProblem = 'corner_count' | 'coordinate' | 'shape' | 'self_intersecting';

export function readOutline(value: unknown): { outline: Outline } | { problem: OutlineProblem } {
  if (!Array.isArray(value)) return { problem: 'corner_count' };
  if (value.length < 4 || value.length > 12) return { problem: 'corner_count' };
  const outline: Outline = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) return { problem: 'coordinate' };
    const rec = raw as Record<string, unknown>;
    const x = readExactCoordinate(rec.x);
    const y = readExactCoordinate(rec.y);
    if (x === null || y === null) return { problem: 'coordinate' };
    outline.push({ x, y });
  }
  const shape = checkOutlineShape(outline);
  if (shape !== null) return { problem: shape };
  return { outline };
}

type Orientation = 'h' | 'v';

function edgeOrientation(a: UPoint, b: UPoint): Orientation | null {
  if (a.y === b.y && a.x !== b.x) return 'h';
  if (a.x === b.x && a.y !== b.y) return 'v';
  return null;
}

function segmentsTouch(a1: UPoint, a2: UPoint, b1: UPoint, b2: UPoint): boolean {
  const aMinX = Math.min(a1.x, a2.x);
  const aMaxX = Math.max(a1.x, a2.x);
  const aMinY = Math.min(a1.y, a2.y);
  const aMaxY = Math.max(a1.y, a2.y);
  const bMinX = Math.min(b1.x, b2.x);
  const bMaxX = Math.max(b1.x, b2.x);
  const bMinY = Math.min(b1.y, b2.y);
  const bMaxY = Math.max(b1.y, b2.y);
  return aMinX <= bMaxX && bMinX <= aMaxX && aMinY <= bMaxY && bMinY <= aMaxY;
}

/** Rectilinear, non-degenerate, simple. Returns the first problem or null. */
export function checkOutlineShape(outline: Outline): OutlineProblem | null {
  const n = outline.length;
  if (n < 4 || n > 12 || n % 2 !== 0) return 'corner_count';
  const orientations: Orientation[] = [];
  for (let i = 0; i < n; i++) {
    const o = edgeOrientation(outline[i], outline[(i + 1) % n]);
    if (o === null) return 'shape';
    orientations.push(o);
  }
  for (let i = 0; i < n; i++) {
    if (orientations[i] === orientations[(i + 1) % n]) return 'shape';
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) continue;
      if (
        segmentsTouch(
          outline[i],
          outline[(i + 1) % n],
          outline[j],
          outline[(j + 1) % n],
        )
      ) {
        return 'self_intersecting';
      }
    }
  }
  return null;
}

export function boundsOf(outline: Outline): Bounds {
  let minX = outline[0].x;
  let maxX = outline[0].x;
  let minY = outline[0].y;
  let maxY = outline[0].y;
  for (const p of outline) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function onBoundary(point: UPoint, outline: Outline): boolean {
  const n = outline.length;
  for (let i = 0; i < n; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % n];
    if (a.y === b.y) {
      if (point.y === a.y && point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x)) {
        return true;
      }
    } else if (point.x === a.x && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y)) {
      return true;
    }
  }
  return false;
}

/** Crossing test for an axis-aligned outline. The point must not sit on the boundary. */
function strictlyInside(point: UPoint, outline: Outline): boolean {
  const n = outline.length;
  let inside = false;
  for (let i = 0; i < n; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % n];
    if (a.x !== b.x) continue;
    if (a.y > point.y !== b.y > point.y && point.x < a.x) inside = !inside;
  }
  return inside;
}

/** A point is inside a room when it lies in the closed polygon, boundary included. */
export function insideOutline(point: UPoint, outline: Outline): boolean {
  return onBoundary(point, outline) || strictlyInside(point, outline);
}

function scaleOutline(outline: Outline, factor: number): Outline {
  return outline.map((p) => ({ x: p.x * factor, y: p.y * factor }));
}

function sortedUnique(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

/** Two outlines overlap when their interiors share any area. Edge and corner contact is allowed. */
export function outlinesOverlap(a: Outline, b: Outline): boolean {
  const a2 = scaleOutline(a, 2);
  const b2 = scaleOutline(b, 2);
  const xs = sortedUnique([...a2.map((p) => p.x), ...b2.map((p) => p.x)]);
  const ys = sortedUnique([...a2.map((p) => p.y), ...b2.map((p) => p.y)]);
  for (let i = 0; i + 1 < xs.length; i++) {
    for (let j = 0; j + 1 < ys.length; j++) {
      const probe = { x: (xs[i] + xs[i + 1]) / 2, y: (ys[j] + ys[j + 1]) / 2 };
      if (strictlyInside(probe, a2) && strictlyInside(probe, b2)) return true;
    }
  }
  return false;
}

/**
 * The anchor: the midpoint of the widest closed segment cut from the outline by the
 * horizontal line through the vertical centre of its bounding box, leftmost on a tie.
 * Returned in 1/20000 units so that the midpoint stays exact.
 */
export function anchorOf(outline: Outline): Anchor {
  const bounds = boundsOf(outline);
  const scaled = scaleOutline(outline, 4);
  const lineY = 2 * (bounds.y * 2 + bounds.h);
  const xs = sortedUnique(scaled.map((p) => p.x));
  const segments: { from: number; to: number }[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const mid = (xs[i] + xs[i + 1]) / 2;
    if (!insideOutline({ x: mid, y: lineY }, scaled)) continue;
    const last = segments[segments.length - 1];
    if (last && last.to === xs[i]) last.to = xs[i + 1];
    else segments.push({ from: xs[i], to: xs[i + 1] });
  }
  let best = segments[0];
  for (const seg of segments) {
    if (seg.to - seg.from > best.to - best.from) best = seg;
  }
  // Scaled by 4 above; the midpoint of a segment is therefore in 1/40000 units.
  return { x: (best.from + best.to) / 2 / 2, y: lineY / 2 };
}
