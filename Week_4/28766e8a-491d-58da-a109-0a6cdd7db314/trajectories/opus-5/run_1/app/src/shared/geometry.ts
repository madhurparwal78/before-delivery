import {
  GRID,
  INSERT_H,
  INSERT_STEP,
  INSERT_W,
  LIMITS,
  type Page,
  type Point,
  type Port,
  type Shape,
  isLayerVisible,
  byId,
} from './document.js';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function boxOf(shape: Shape): Box {
  return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
}

export function boxRight(b: Box): number {
  return b.x + b.w;
}

export function boxBottom(b: Box): number {
  return b.y + b.h;
}

export function unionBox(boxes: readonly Box[]): Box {
  const first = boxes[0];
  if (!first) throw new Error('unionBox needs at least one box');
  let x1 = first.x;
  let y1 = first.y;
  let x2 = boxRight(first);
  let y2 = boxBottom(first);
  for (const b of boxes.slice(1)) {
    x1 = Math.min(x1, b.x);
    y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, boxRight(b));
    y2 = Math.max(y2, boxBottom(b));
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Boxes that only touch at an edge do not overlap. */
export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < boxRight(b) && boxRight(a) > b.x && a.y < boxBottom(b) && boxBottom(a) > b.y;
}

/** Rounding to the nearest multiple of 8 sends halves upward. */
export function snap(value: number): number {
  return Math.round(value / GRID) * GRID;
}

/** Without snapping, values round to the nearest integer, halves upward. */
export function roundUnit(value: number): number {
  return Math.round(value);
}

/**
 * The shared offset a drag commits. With snapping on, the offset is chosen so the
 * selection's bounding box lands with its left and top edges on multiples of 8.
 */
export function moveOffset(
  selectionBox: Box,
  rawDx: number,
  rawDy: number,
  snapping: boolean,
): { dx: number; dy: number } {
  if (!snapping) {
    return { dx: roundUnit(rawDx), dy: roundUnit(rawDy) };
  }
  return {
    dx: snap(selectionBox.x + rawDx) - selectionBox.x,
    dy: snap(selectionBox.y + rawDy) - selectionBox.y,
  };
}

export type Corner = 'nw' | 'ne' | 'se' | 'sw';

/**
 * A corner resize keeps the opposite corner fixed. With snapping on the dragged
 * corner's two edges round to multiples of 8; `w` and `h` follow from the edges and
 * are never rounded on their own, so an off-grid fixed edge stays where it was.
 */
export function resizeBox(
  start: Box,
  corner: Corner,
  rawX: number,
  rawY: number,
  snapping: boolean,
): Box {
  const fixedX = corner === 'nw' || corner === 'sw' ? boxRight(start) : start.x;
  const fixedY = corner === 'nw' || corner === 'ne' ? boxBottom(start) : start.y;
  const draggedX = snapping ? snap(rawX) : roundUnit(rawX);
  const draggedY = snapping ? snap(rawY) : roundUnit(rawY);
  return {
    ...resizeAxis(fixedX, draggedX),
    ...resizeAxisY(fixedY, draggedY),
  };
}

function limitEdge(fixed: number, dragged: number): number {
  const size = Math.abs(dragged - fixed);
  const sign = dragged >= fixed ? 1 : -1;
  if (size < LIMITS.sizeMin) return fixed + sign * LIMITS.sizeMin;
  if (size > LIMITS.sizeMax) return fixed + sign * LIMITS.sizeMax;
  return dragged;
}

function resizeAxis(fixed: number, dragged: number): { x: number; w: number } {
  const edge = limitEdge(fixed, dragged);
  return { x: Math.min(fixed, edge), w: Math.abs(edge - fixed) };
}

function resizeAxisY(fixed: number, dragged: number): { y: number; h: number } {
  const edge = limitEdge(fixed, dragged);
  return { y: Math.min(fixed, edge), h: Math.abs(edge - fixed) };
}

/** Keyboard nudges are never snapped: Arrow moves 8 units and Shift+Arrow moves 1. */
export function nudgeStep(shiftHeld: boolean): number {
  return shiftHeld ? 1 : GRID;
}

/**
 * The insertion position for a 160x80 shape, given the document point at the centre
 * of `#canvas`'s on-screen box. Insertion is never snapped.
 */
export function insertionPosition(page: Page, centre: { x: number; y: number }): { x: number; y: number } {
  const y = Math.floor(centre.y - INSERT_H / 2);
  let x = Math.floor(centre.x - INSERT_W / 2);
  const obstacles = page.shapes.filter((s) => isLayerVisible(page, s.layer)).map(boxOf);
  while (obstacles.some((o) => boxesOverlap({ x, y, w: INSERT_W, h: INSERT_H }, o))) {
    x += INSERT_STEP;
  }
  return { x, y };
}

/** The four ports sit at the midpoints of the shape's edges, rounded down to integers. */
export function portPoint(shape: Shape | Box, port: Port): Point {
  const cx = Math.floor(shape.x + shape.w / 2);
  const cy = Math.floor(shape.y + shape.h / 2);
  switch (port) {
    case 'n':
      return [cx, shape.y];
    case 'e':
      return [shape.x + shape.w, cy];
    case 's':
      return [cx, shape.y + shape.h];
    case 'w':
      return [shape.x, cy];
  }
}

/** The outward normal of a port, as a unit step. */
export function portNormal(port: Port): Point {
  switch (port) {
    case 'n':
      return [0, -1];
    case 'e':
      return [1, 0];
    case 's':
      return [0, 1];
    case 'w':
      return [-1, 0];
  }
}

export interface PortPair {
  from: Port;
  to: Port;
}

/** The default port pair between a source and a target box. */
export function defaultPortPair(source: Box, target: Box): PortPair {
  const sourceCentreX = source.x + source.w / 2;
  const sourceCentreY = source.y + source.h / 2;
  const targetCentreX = target.x + target.w / 2;
  const targetCentreY = target.y + target.h / 2;
  const toRight = targetCentreX >= sourceCentreX;
  const below = targetCentreY >= sourceCentreY;
  const horizontalGap = toRight ? target.x - boxRight(source) : source.x - boxRight(target);
  const verticalGap = below ? target.y - boxBottom(source) : source.y - boxBottom(target);
  if (horizontalGap >= verticalGap) {
    return toRight ? { from: 'e', to: 'w' } : { from: 'w', to: 'e' };
  }
  return below ? { from: 's', to: 'n' } : { from: 'n', to: 's' };
}

/**
 * A connector label's centre sits at the midpoint of its route's longest segment. When
 * two or more segments tie for longest, the first of them along the route is used.
 */
export function connectorLabelPoint(route: readonly Point[]): Point {
  let best = 0;
  let bestLength = -1;
  for (let i = 0; i + 1 < route.length; i += 1) {
    const a = route[i];
    const b = route[i + 1];
    if (!a || !b) continue;
    const length = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
    if (length > bestLength) {
      bestLength = length;
      best = i;
    }
  }
  const a = route[best] ?? [0, 0];
  const b = route[best + 1] ?? a;
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/**
 * Align and distribute units: each selected group is one rigid box (the bounding box of
 * its members) and each ungrouped selected shape is its own box.
 */
export interface Unit {
  shapes: Shape[];
  box: Box;
  /** The lowest shape id in the unit, used to break distribute ties. */
  key: string;
}

export function selectionUnits(page: Page, selected: readonly Shape[]): Unit[] {
  const ungrouped: Unit[] = [];
  const byGroup = new Map<string, Shape[]>();
  for (const shape of selected) {
    if (shape.group === null) {
      ungrouped.push({ shapes: [shape], box: boxOf(shape), key: shape.id });
      continue;
    }
    const members = byGroup.get(shape.group) ?? [];
    members.push(shape);
    byGroup.set(shape.group, members);
  }
  const grouped: Unit[] = [];
  for (const [groupId, members] of byGroup) {
    const group = page.groups.find((g) => g.id === groupId);
    const shapes = group
      ? (group.members.map((id) => page.shapes.find((s) => s.id === id)).filter((s): s is Shape => s !== undefined))
      : members;
    const ids = shapes.map((s) => s.id).sort(byId);
    grouped.push({ shapes, box: unionBox(shapes.map(boxOf)), key: ids[0] ?? groupId });
  }
  return [...ungrouped, ...grouped];
}

export type AlignSide = 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom';
export type DistributeAxis = 'horizontal' | 'vertical';

/** The move each unit makes for an align. Results round down. */
export function alignOffsets(units: readonly Unit[], side: AlignSide): Map<Unit, { dx: number; dy: number }> {
  const selection = unionBox(units.map((u) => u.box));
  const offsets = new Map<Unit, { dx: number; dy: number }>();
  for (const unit of units) {
    let dx = 0;
    let dy = 0;
    switch (side) {
      case 'left':
        dx = selection.x - unit.box.x;
        break;
      case 'centre':
        dx = Math.floor(selection.x + selection.w / 2 - unit.box.w / 2) - unit.box.x;
        break;
      case 'right':
        dx = boxRight(selection) - unit.box.w - unit.box.x;
        break;
      case 'top':
        dy = selection.y - unit.box.y;
        break;
      case 'middle':
        dy = Math.floor(selection.y + selection.h / 2 - unit.box.h / 2) - unit.box.y;
        break;
      case 'bottom':
        dy = boxBottom(selection) - unit.box.h - unit.box.y;
        break;
    }
    offsets.set(unit, { dx, dy });
  }
  return offsets;
}

/** The move each unit makes for a distribute. Each gap rounds down. */
export function distributeOffsets(
  units: readonly Unit[],
  axis: DistributeAxis,
): Map<Unit, { dx: number; dy: number }> {
  const horizontal = axis === 'horizontal';
  const centre = (u: Unit): number => (horizontal ? u.box.x + u.box.w / 2 : u.box.y + u.box.h / 2);
  const size = (u: Unit): number => (horizontal ? u.box.w : u.box.h);
  const start = (u: Unit): number => (horizontal ? u.box.x : u.box.y);
  const sorted = [...units].sort((a, b) => centre(a) - centre(b) || byId(a.key, b.key));
  const offsets = new Map<Unit, { dx: number; dy: number }>();
  for (const unit of sorted) offsets.set(unit, { dx: 0, dy: 0 });
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last || sorted.length < 3) return offsets;
  const span = start(last) + size(last) - start(first);
  const totalSize = sorted.reduce((sum, u) => sum + size(u), 0);
  const gap = (span - totalSize) / (sorted.length - 1);
  let precedingSize = size(first);
  for (let i = 1; i < sorted.length - 1; i += 1) {
    const unit = sorted[i];
    if (!unit) continue;
    const target = Math.floor(start(first) + precedingSize + i * gap);
    offsets.set(unit, horizontal ? { dx: target - start(unit), dy: 0 } : { dx: 0, dy: target - start(unit) });
    precedingSize += size(unit);
  }
  return offsets;
}
