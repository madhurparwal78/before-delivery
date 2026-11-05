import type { Shape } from "./domain.js";

// Shelf geometry, decided here and only here.
// The shelf is a circle 23 in across, centred at (11.5, 11.5).
// Three posts: 1x1 in squares with these top-left corners.
export const SHELF_DIAMETER = 23;
export const SHELF_CENTER = 11.5;
export const SHELF_RADIUS = 11.5;
export const POSTS: Array<{ x: number; y: number; size: number }> = [
  { x: 11, y: 0.5, size: 1 },
  { x: 2.5, y: 16.5, size: 1 },
  { x: 19.5, y: 16.5, size: 1 }
];

// Footprint in shelf coordinates. A round/plate piece is a circle of its
// rounded diameter; (x, y) is the top-left of its bounding square.
export interface Footprint {
  shape: Shape;
  x: number;
  y: number;
  w: number; // bounding width (diameter or rotated length along x)
  h: number; // bounding depth (diameter or rotated width along y)
  rotation: number;
}

export function boundsFor(shape: Shape, rotation: number, dims: { length: number; width: number; diameter: number }): { w: number; h: number } {
  if (shape === "rectangular") {
    const rotated = rotation === 90 || rotation === 270;
    return { w: rotated ? dims.width : dims.length, h: rotated ? dims.length : dims.width };
  }
  return { w: dims.diameter, h: dims.diameter };
}

export function makeFootprint(shape: Shape, rotation: number, dims: { length: number; width: number; diameter: number }, x: number, y: number): Footprint {
  const { w, h } = boundsFor(shape, rotation, dims);
  return { shape, x, y, w, h, rotation };
}

// The interior of the footprint meets the interior of a 1x1 post.
export function meetsPost(fp: Footprint, post: { x: number; y: number; size: number }): boolean {
  if (fp.shape === "rectangular") {
    return fp.x < post.x + post.size && post.x < fp.x + fp.w && fp.y < post.y + post.size && post.y < fp.y + fp.h;
  }
  const cx = fp.x + fp.w / 2;
  const cy = fp.y + fp.h / 2;
  const r = fp.w / 2;
  const nx = Math.max(post.x, Math.min(cx, post.x + post.size));
  const ny = Math.max(post.y, Math.min(cy, post.y + post.size));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

// Any part of the footprint lies outside the shelf circle (touching the rim is allowed).
export function pastShelfEdge(fp: Footprint): boolean {
  if (fp.shape === "rectangular") {
    const corners: Array<[number, number]> = [
      [fp.x, fp.y],
      [fp.x + fp.w, fp.y],
      [fp.x, fp.y + fp.h],
      [fp.x + fp.w, fp.y + fp.h]
    ];
    return corners.some(([cx, cy]) => {
      const dx = cx - SHELF_CENTER;
      const dy = cy - SHELF_CENTER;
      return dx * dx + dy * dy > SHELF_RADIUS * SHELF_RADIUS;
    });
  }
  const cx = fp.x + fp.w / 2;
  const cy = fp.y + fp.h / 2;
  const r = fp.w / 2;
  const dx = cx - SHELF_CENTER;
  const dy = cy - SHELF_CENTER;
  const dist = Math.sqrt(dx * dx + dy * dy);
  return dist + r > SHELF_RADIUS;
}

// The footprint's interior meets another footprint's interior (touching edges allowed).
export function footprintsOverlap(a: Footprint, b: Footprint): boolean {
  const aRound = a.shape !== "rectangular";
  const bRound = b.shape !== "rectangular";
  if (aRound && bRound) {
    const ax = a.x + a.w / 2;
    const ay = a.y + a.h / 2;
    const bx = b.x + b.w / 2;
    const by = b.y + b.h / 2;
    const dx = ax - bx;
    const dy = ay - by;
    const rsum = a.w / 2 + b.w / 2;
    return dx * dx + dy * dy < rsum * rsum;
  }
  if (!aRound && !bRound) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  }
  const [rect, circ] = aRound ? [b, a] : [a, b];
  const cx = circ.x + circ.w / 2;
  const cy = circ.y + circ.h / 2;
  const r = circ.w / 2;
  const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

// First clear position scanning rows top to bottom, left to right in half-inch steps.
export function firstClearPosition(
  dims: { length: number; width: number; diameter: number },
  shape: Shape,
  rotation: number,
  placed: Footprint[]
): { x: number; y: number } {
  const test = (x: number, y: number): boolean => {
    const fp = makeFootprint(shape, rotation, dims, x, y);
    if (pastShelfEdge(fp)) return false;
    for (const p of placed) if (footprintsOverlap(fp, p)) return false;
    for (const post of POSTS) if (meetsPost(fp, post)) return false;
    return true;
  };
  for (let y = 0; y <= 23; y += 0.5) {
    for (let x = 0; x <= 23; x += 0.5) {
      if (test(x, y)) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}
