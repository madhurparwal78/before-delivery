import { PIECES, type DoorWall, type PieceKind } from './seed.js';

export interface LayoutItem {
  kind: PieceKind;
  x: number;
  y: number;
  rotationDeg: number;
}

export interface RoomSpec {
  widthM: number;
  depthM: number;
  doorWall: DoorWall;
}

export const GRID_STEP_M = 0.25;
export const ROTATION_STEP_DEG = 15;
export const DOOR_WIDTH_M = 1.2;
export const DOOR_CLEARANCE_M = 0.6;

/** Tolerance in metres: touching a wall or another footprint edge is allowed. */
const EPS = 1e-6;

export interface Point {
  x: number;
  y: number;
}

export type Polygon = readonly Point[];

/**
 * The footprint corners of a placed piece. At 0° the first footprint dimension
 * runs along x; rotationDeg turns the piece counter-clockwise seen from above.
 */
export function footprintCorners(item: LayoutItem): Point[] {
  const spec = PIECES[item.kind];
  const [alongX, alongY] = spec.footprintM;
  const hx = alongX / 2;
  const hy = alongY / 2;
  const theta = (item.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return [
    { x: -hx, y: -hy },
    { x: hx, y: -hy },
    { x: hx, y: hy },
    { x: -hx, y: hy },
  ].map((c) => ({
    x: item.x + c.x * cos - c.y * sin,
    y: item.y + c.x * sin + c.y * cos,
  }));
}

export function rectanglePolygon(x0: number, y0: number, x1: number, y1: number): Polygon {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

/**
 * The door is 1.2 m wide, centred on its wall; the clearance zone is the door
 * opening extended 0.6 m into the room.
 */
export function doorClearanceZone(room: RoomSpec): Polygon {
  const half = DOOR_WIDTH_M / 2;
  switch (room.doorWall) {
    case 'front': {
      const cx = room.widthM / 2;
      return rectanglePolygon(cx - half, 0, cx + half, DOOR_CLEARANCE_M);
    }
    case 'back': {
      const cx = room.widthM / 2;
      return rectanglePolygon(cx - half, room.depthM - DOOR_CLEARANCE_M, cx + half, room.depthM);
    }
    case 'left': {
      const cy = room.depthM / 2;
      return rectanglePolygon(0, cy - half, DOOR_CLEARANCE_M, cy + half);
    }
    case 'right': {
      const cy = room.depthM / 2;
      return rectanglePolygon(room.widthM - DOOR_CLEARANCE_M, cy - half, room.widthM, cy + half);
    }
  }
}

function axesOf(poly: Polygon): Point[] {
  const axes: Point[] = [];
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const edge = { x: b.x - a.x, y: b.y - a.y };
    const len = Math.hypot(edge.x, edge.y);
    if (len > EPS) axes.push({ x: -edge.y / len, y: edge.x / len });
  }
  return axes;
}

function project(poly: Polygon, axis: Point): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const p of poly) {
    const v = p.x * axis.x + p.y * axis.y;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

/** True when the two convex polygons share area; touching edges do not count. */
export function polygonsShareArea(a: Polygon, b: Polygon): boolean {
  for (const axis of [...axesOf(a), ...axesOf(b)]) {
    const pa = project(a, axis);
    const pb = project(b, axis);
    const overlap = Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min);
    if (overlap <= EPS) return false;
  }
  return true;
}

function isMultipleOf(value: number, step: number): boolean {
  const ratio = value / step;
  return Math.abs(ratio - Math.round(ratio)) < 1e-9;
}

export interface PlacementFailure {
  index: number;
  message: string;
}

/** Snap a metre value to the quarter-metre grid. */
export function snapMetres(value: number): number {
  return Math.round(value / GRID_STEP_M) * GRID_STEP_M;
}

/** Normalise a rotation to a 15° step within 0..345. */
export function snapRotation(deg: number): number {
  const stepped = Math.round(deg / ROTATION_STEP_DEG) * ROTATION_STEP_DEG;
  return ((stepped % 360) + 360) % 360;
}

/**
 * Validate a layout against the room. Items are checked in order and the first
 * failing item decides the answer. This is the only place placement is judged.
 */
export function validateLayout(
  items: readonly LayoutItem[],
  room: RoomSpec,
  required: readonly PieceKind[],
): PlacementFailure | null {
  const door = doorClearanceZone(room);
  const corners = items.map((item) => footprintCorners(item));

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!;
    const label = PIECES[item.kind]?.label ?? item.kind;

    if (
      !Number.isFinite(item.x) ||
      !Number.isFinite(item.y) ||
      !Number.isFinite(item.rotationDeg) ||
      !isMultipleOf(item.x, GRID_STEP_M) ||
      !isMultipleOf(item.y, GRID_STEP_M) ||
      !isMultipleOf(item.rotationDeg, ROTATION_STEP_DEG) ||
      item.rotationDeg < 0 ||
      item.rotationDeg > 345
    ) {
      return { index: i, message: 'Positions snap to 0.25 m and turns to 15°.' };
    }

    const isRequired = required.includes(item.kind);
    const seenEarlier = items.slice(0, i).some((other) => other.kind === item.kind);
    if (!isRequired || seenEarlier) {
      return { index: i, message: "That piece isn't part of this commission." };
    }

    const mine = corners[i]!;
    const insideRoom = mine.every(
      (c) =>
        c.x >= -EPS && c.x <= room.widthM + EPS && c.y >= -EPS && c.y <= room.depthM + EPS,
    );
    if (!insideRoom) {
      return { index: i, message: `Keep the ${label} inside the room.` };
    }

    for (let j = 0; j < items.length; j += 1) {
      if (j === i) continue;
      if (polygonsShareArea(mine, corners[j]!)) {
        const otherLabel = PIECES[items[j]!.kind]?.label ?? items[j]!.kind;
        return { index: i, message: `The ${label} overlaps the ${otherLabel}.` };
      }
    }

    if (polygonsShareArea(mine, door)) {
      return { index: i, message: `Leave 0.6 m clear inside the door for the ${label}.` };
    }
  }

  return null;
}

/** A layout is complete when it holds every required piece. */
export function layoutIsComplete(items: readonly LayoutItem[], required: readonly PieceKind[]): boolean {
  return required.every((kind) => items.some((item) => item.kind === kind));
}

/** Metres with up to two decimals, for placement announcements. */
export function formatMetres(value: number): string {
  return String(Number(value.toFixed(2)));
}
