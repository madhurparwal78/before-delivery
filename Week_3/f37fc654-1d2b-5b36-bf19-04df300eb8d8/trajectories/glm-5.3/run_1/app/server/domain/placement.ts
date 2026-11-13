// The one place placement is validated.
import { requiredPieces } from './seed.js';
import type { AddOn, InstallationType, DoorWall } from './seed.js';

export interface LayoutItem {
  kind: string;
  x: number;
  y: number;
  rotationDeg: number;
}

export interface Room {
  widthM: number;
  depthM: number;
  doorWall: DoorWall;
}

const DOOR_WIDTH = 1.2;
const DOOR_CLEARANCE = 0.6;

interface Corner {
  x: number;
  y: number;
}

function footprintCorners(item: LayoutItem, w: number, d: number): Corner[] {
  // Centre-relative corners, rotated counter-clockwise as seen from above.
  const rad = (item.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const pts: Array<[number, number]> = [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ];
  return pts.map(([px, py]) => ({
    x: item.x + px * cos - py * sin,
    y: item.y + px * sin + py * cos,
  }));
}

/** Rectangle from corners of an axis-aligned footprint at 0/90/180/270, or a conservative bound otherwise. */
function bounds(corners: Corner[]): { minX: number; minY: number; maxX: number; maxY: number } {
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

export function doorClearanceZone(room: Room): { minX: number; minY: number; maxX: number; maxY: number } {
  // Door is centred on its wall; clearance extends 0.6 m into the room.
  const half = DOOR_WIDTH / 2;
  switch (room.doorWall) {
    case 'front':
      return { minX: room.widthM / 2 - half, minY: 0, maxX: room.widthM / 2 + half, maxY: DOOR_CLEARANCE };
    case 'back':
      return { minX: room.widthM / 2 - half, minY: room.depthM - DOOR_CLEARANCE, maxX: room.widthM / 2 + half, maxY: room.depthM };
    case 'left':
      return { minX: 0, minY: room.depthM / 2 - half, maxX: DOOR_CLEARANCE, maxY: room.depthM / 2 + half };
    case 'right':
      return { minX: room.widthM - DOOR_CLEARANCE, minY: room.depthM / 2 - half, maxX: room.widthM, maxY: room.depthM / 2 + half };
  }
}

function rectsOverlap(a: { minX: number; minY: number; maxX: number; maxY: number }, b: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
  // Sharing area means a strict overlap; touching edges is allowed.
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

/** Validate a full layout. Returns the first failing item's message, or null. */
export function validateLayout(
  items: LayoutItem[],
  room: Room,
  type: InstallationType,
  addOns: AddOn[],
): string | null {
  const required = requiredPieces(type, addOns);
  const seen = new Set<string>();
  const placedBounds: Array<{ label: string; rect: { minX: number; minY: number; maxX: number; maxY: number } }> = [];
  const zone = doorClearanceZone(room);

  for (const item of items) {
    const xCm = Math.round(item.x * 100);
    const yCm = Math.round(item.y * 100);
    const snapOk =
      Number.isFinite(item.x) && Number.isFinite(item.y) &&
      Math.abs(item.x * 100 - xCm) < 1e-9 &&
      Math.abs(item.y * 100 - yCm) < 1e-9 &&
      xCm >= 0 && yCm >= 0 &&
      xCm % 25 === 0 &&
      yCm % 25 === 0 &&
      Number.isInteger(item.rotationDeg / 15) &&
      item.rotationDeg >= 0 &&
      item.rotationDeg <= 345;
    if (!snapOk) return 'Positions snap to 0.25 m and turns to 15°.';

    const piece = required.find((p) => p.kind === item.kind);
    if (!piece || seen.has(item.kind)) return 'That piece isn\'t part of this commission.';
    seen.add(item.kind);

    const corners = footprintCorners(item, piece.w, piece.d);
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    // Inside the room: every corner within [0,width]x[0,depth], touching allowed.
    if (Math.min(...xs) < -1e-9 || Math.max(...xs) > room.widthM + 1e-9 || Math.min(...ys) < -1e-9 || Math.max(...ys) > room.depthM + 1e-9) {
      return `Keep the ${piece.label} inside the room.`;
    }

    const rect = bounds(corners);
    for (const other of placedBounds) {
      if (rectsOverlap(rect, other.rect)) {
        return `The ${piece.label} overlaps the ${other.label}.`;
      }
    }
    if (rectsOverlap(rect, zone)) {
      return `Leave 0.6 m clear inside the door for the ${piece.label}.`;
    }
    placedBounds.push({ label: piece.label, rect });
  }
  return null;
}

/** True when the layout contains every required piece. */
export function layoutComplete(items: LayoutItem[], type: InstallationType, addOns: AddOn[]): boolean {
  const required = new Set(requiredPieces(type, addOns).map((p) => p.kind));
  for (const item of items) required.delete(item.kind);
  return required.size === 0;
}

