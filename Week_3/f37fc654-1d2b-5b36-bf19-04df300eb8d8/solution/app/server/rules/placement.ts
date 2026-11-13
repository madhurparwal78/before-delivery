// Placement checks (brief: Business rules › Pieces and placement), applied item by item in order.
import { FOOTPRINTS, GRID_M, TURN_DEG, pieceLabel, type DoorWall, type PieceKind } from "../../shared/catalog.js";

export interface LayoutItem {
  kind: PieceKind;
  x: number;
  y: number;
  rotationDeg: number;
}

export interface Room {
  widthM: number;
  depthM: number;
  doorWall: DoorWall;
}

type Point = readonly [number, number];
const EPS = 1e-9;
const DOOR_WIDTH = 1.2;
const DOOR_CLEARANCE = 0.6;

function onGrid(value: number, step: number): boolean {
  return Math.abs(value / step - Math.round(value / step)) < 1e-9;
}

function corners(item: LayoutItem): Point[] {
  const [a, b] = FOOTPRINTS[item.kind];
  const t = (item.rotationDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [[-a / 2, -b / 2], [a / 2, -b / 2], [a / 2, b / 2], [-a / 2, b / 2]].map(
    ([dx, dy]) => [item.x + dx * c - dy * s, item.y + dx * s + dy * c] as const,
  );
}

function axes(poly: Point[]): Point[] {
  return poly.map((p, i) => {
    const q = poly[(i + 1) % poly.length];
    return [-(q[1] - p[1]), q[0] - p[0]] as const;
  });
}

/** Two convex polygons share area (touching edges does not count). */
function shareArea(p: Point[], q: Point[]): boolean {
  for (const [ax, ay] of [...axes(p), ...axes(q)]) {
    const project = (poly: Point[]): number[] => poly.map(([x, y]) => x * ax + y * ay);
    const pp = project(p);
    const qq = project(q);
    const len = Math.hypot(ax, ay);
    if (Math.max(...pp) - Math.min(...qq) <= EPS * len || Math.max(...qq) - Math.min(...pp) <= EPS * len) return false;
  }
  return true;
}

function rect(x0: number, y0: number, x1: number, y1: number): Point[] {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

/** The door opening (1.2 m, centred on its wall) extended 0.6 m into the room. */
function doorClearance(room: Room): Point[] {
  const { widthM: w, depthM: d } = room;
  const half = DOOR_WIDTH / 2;
  switch (room.doorWall) {
    case "front": return rect(w / 2 - half, 0, w / 2 + half, DOOR_CLEARANCE);
    case "back": return rect(w / 2 - half, d - DOOR_CLEARANCE, w / 2 + half, d);
    case "left": return rect(0, d / 2 - half, DOOR_CLEARANCE, d / 2 + half);
    case "right": return rect(w - DOOR_CLEARANCE, d / 2 - half, w, d / 2 + half);
  }
}

/** Holding a day needs every required piece in the layout. */
export function allPiecesPlaced(required: readonly PieceKind[], items: readonly LayoutItem[]): boolean {
  return required.every((kind) => items.some((i) => i.kind === kind));
}

/** The first failing item and its published message, or null when the layout is valid. */
export function firstPlacementError(items: readonly LayoutItem[], room: Room, required: readonly PieceKind[]): { index: number; message: string } | null {
  const seen = new Set<PieceKind>();
  const placed: { item: LayoutItem; shape: Point[] }[] = [];
  for (const [index, item] of items.entries()) {
    const fail = (message: string): { index: number; message: string } => ({ index, message });
    if (!onGrid(item.x, GRID_M) || !onGrid(item.y, GRID_M) || !onGrid(item.rotationDeg, TURN_DEG) || item.rotationDeg < 0 || item.rotationDeg >= 360) {
      return fail("Positions snap to 0.25 m and turns to 15°.");
    }
    if (!required.includes(item.kind) || seen.has(item.kind)) return fail("That piece isn't part of this commission.");
    seen.add(item.kind);
    const label = pieceLabel(item.kind);
    const shape = corners(item);
    if (shape.some(([x, y]) => x < -EPS || y < -EPS || x > room.widthM + EPS || y > room.depthM + EPS)) {
      return fail(`Keep the ${label} inside the room.`);
    }
    const other = placed.find((p) => shareArea(shape, p.shape));
    if (other) return fail(`The ${label} overlaps the ${pieceLabel(other.item.kind)}.`);
    if (shareArea(shape, doorClearance(room))) return fail(`Leave 0.6 m clear inside the door for the ${label}.`);
    placed.push({ item, shape });
  }
  return null;
}
