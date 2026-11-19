import type { Box, PortName, Shape } from './model.js';
import { LIMITS } from './model.js';
import { shapeLabel } from './ids.js';

/** Port position, rounded down to integers. */
export function portPosition(shape: Box, port: PortName): { x: number; y: number } {
  switch (port) {
    case 'n': return { x: Math.floor(shape.x + shape.w / 2), y: shape.y };
    case 'e': return { x: shape.x + shape.w, y: Math.floor(shape.y + shape.h / 2) };
    case 's': return { x: Math.floor(shape.x + shape.w / 2), y: shape.y + shape.h };
    case 'w': return { x: shape.x, y: Math.floor(shape.y + shape.h / 2) };
  }
}

export function portOutward(port: PortName): { dx: number; dy: number } {
  switch (port) {
    case 'n': return { dx: 0, dy: -1 };
    case 'e': return { dx: 1, dy: 0 };
    case 's': return { dx: 0, dy: 1 };
    case 'w': return { dx: -1, dy: 0 };
  }
}

/** Default port pair from the geometry rules. */
export function defaultPortPair(source: Box, target: Box): { from: PortName; to: PortName } {
  const sourceCx = source.x + source.w / 2;
  const sourceCy = source.y + source.h / 2;
  const targetCx = target.x + target.w / 2;
  const targetCy = target.y + target.h / 2;
  const right = targetCx >= sourceCx;
  const below = targetCy >= sourceCy;
  const horizontalGap = right ? target.x - (source.x + source.w) : source.x - (target.x + target.w);
  const verticalGap = below ? target.y - (source.y + source.h) : source.y - (target.y + target.h);
  if (horizontalGap >= verticalGap) {
    return right ? { from: 'e', to: 'w' } : { from: 'w', to: 'e' };
  }
  return below ? { from: 's', to: 'n' } : { from: 'n', to: 's' };
}

/** Round to nearest multiple of the grid, halves up. */
export function snap(value: number, grid = LIMITS.gridSize): number {
  return Math.ceil(value / grid - 0.5) * grid;
}

/** Snap a move so the selection box's left and top land on multiples of 8. */
export function snapMove(box: Box): { dx: number; dy: number } {
  return { dx: snap(box.x) - box.x, dy: snap(box.y) - box.y };
}

/**
 * Snap a corner resize with the opposite corner fixed. Edges snap; the fixed
 * edge stays where it was, and clamping keeps sizes within 24..2000.
 */
export function snapResize(
  fixedX: number, fixedY: number, draggedX: number, draggedY: number,
  grid = LIMITS.gridSize,
): { x: number; y: number; w: number; h: number } {
  let left = Math.min(fixedX, draggedX);
  let right = Math.max(fixedX, draggedX);
  let top = Math.min(fixedY, draggedY);
  let bottom = Math.max(fixedY, draggedY);
  // Snap the dragged edges only.
  if (draggedX === right) right = snap(right, grid); else left = snap(left, grid);
  if (draggedY === bottom) bottom = snap(bottom, grid); else top = snap(top, grid);
  // Clamp sizes against the fixed corner.
  if (right - left > LIMITS.maxSize) {
    const edge = draggedX === right ? fixedX + LIMITS.maxSize : fixedX - LIMITS.maxSize;
    if (draggedX === right) right = edge; else left = edge;
  }
  if (bottom - top > LIMITS.maxSize) {
    const edge = draggedY === bottom ? fixedY + LIMITS.maxSize : fixedY - LIMITS.maxSize;
    if (draggedY === bottom) bottom = edge; else top = edge;
  }
  if (right - left < LIMITS.minSize) {
    const edge = draggedX === right ? fixedX + LIMITS.minSize : fixedX - LIMITS.minSize;
    if (draggedX === right) right = edge; else left = edge;
  }
  if (bottom - top < LIMITS.minSize) {
    const edge = draggedY === bottom ? fixedY + LIMITS.minSize : fixedY - LIMITS.minSize;
    if (draggedY === bottom) bottom = edge; else top = edge;
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function boundingBox(boxes: Box[]): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Insertion position from the geometry rules; cx, cy are document units. */
export function insertionPosition(cx: number, cy: number, occupied: Box[]): { x: number; y: number } {
  const box: Box = {
    x: Math.floor(cx - LIMITS.insertWidth / 2),
    y: Math.floor(cy - LIMITS.insertHeight / 2),
    w: LIMITS.insertWidth,
    h: LIMITS.insertHeight,
  };
  let guard = 0;
  while (occupied.some((o) => boxesOverlap(box, o)) && guard < 10000) {
    box.x += LIMITS.insertShift;
    guard++;
  }
  return { x: box.x, y: box.y };
}

export type AlignSide = 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom';

/** Align: every unit's box moves to the selection box edge. Results round down. */
export function alignUnits(units: { id: string; box: Box; members: string[] }[], side: AlignSide):
  { id: string; dx: number; dy: number }[] {
  const sel = boundingBox(units.map((u) => u.box));
  const moves: { id: string; dx: number; dy: number }[] = [];
  for (const unit of units) {
    let dx = 0, dy = 0;
    if (side === 'left') dx = Math.floor(sel.x - unit.box.x);
    else if (side === 'right') dx = Math.floor(sel.x + sel.w - (unit.box.x + unit.box.w));
    else if (side === 'centre') dx = Math.floor(sel.x + sel.w / 2 - (unit.box.x + unit.box.w / 2));
    else if (side === 'top') dy = Math.floor(sel.y - unit.box.y);
    else if (side === 'bottom') dy = Math.floor(sel.y + sel.h - (unit.box.y + unit.box.h));
    else if (side === 'middle') dy = Math.floor(sel.y + sel.h / 2 - (unit.box.y + unit.box.h / 2));
    moves.push({ id: unit.id, dx, dy });
  }
  return moves;
}

export function distributeUnits(units: { id: string; box: Box; members: string[] }[], axis: 'h' | 'v'):
  { id: string; dx: number; dy: number }[] {
  const along = (b: Box) => (axis === 'h' ? b.x + b.w / 2 : b.y + b.h / 2);
  const sorted = [...units].sort((a, b) => {
    const d = along(a.box) - along(b.box);
    if (d !== 0) return d;
    return a.id < b.id ? -1 : 1;
  });
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const firstEdge = axis === 'h' ? first.box.x : first.box.y;
  const lastFarEdge = axis === 'h' ? last.box.x + last.box.w : last.box.y + last.box.h;
  const farMost = Math.max(...sorted.map((u) => (axis === 'h' ? u.box.x + u.box.w : u.box.y + u.box.h)));
  const span = Math.max(lastFarEdge, farMost) - firstEdge;
  const totalSize = sorted.reduce((sum, u) => sum + (axis === 'h' ? u.box.w : u.box.h), 0);
  const gaps = sorted.length - 1;
  const gap = gaps > 0 ? (span - totalSize) / gaps : 0;
  const floorGap = Math.floor(gap);
  const moves: { id: string; dx: number; dy: number }[] = [];
  let cursor = firstEdge;
  for (const unit of sorted) {
    const size = axis === 'h' ? unit.box.w : unit.box.h;
    const current = axis === 'h' ? unit.box.x : unit.box.y;
    const target = cursor;
    moves.push({ id: unit.id, dx: axis === 'h' ? target - current : 0, dy: axis === 'v' ? target - current : 0 });
    cursor = target + size + floorGap;
  }
  return moves;
}

export function shapeBox(shape: Shape): Box {
  return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
}

export function shapeName(shape: Shape): string {
  return shapeLabel(shape);
}
