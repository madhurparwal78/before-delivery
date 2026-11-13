import { SHELF_START } from './chapters.js';

/** One continuous camera path; equal steps of progress cover equal distances
 * within 5%. The path runs down the alley and ends facing the shelf, with
 * every chapter covering the same arc length. */
export interface Vec3 { x: number; y: number; z: number }

const SHELF_Z = -178;

/** The path runs from the alley's start to the shelf, one straight run with a
 * gentle rise at the end, so equal steps of progress cover equal distances. */
const START_Z = 6;
const END_Z = -168;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

/** Camera position for a progress value, on the path. */
export function cameraAt(progress: number): { position: Vec3; look: Vec3 } {
  const clamped = Math.max(0, Math.min(1, progress));
  // One straight run: equal steps of progress cover equal distances exactly.
  const z = lerp(START_Z, END_Z, clamped);
  // The camera rises slightly toward the shelf over the last stretch.
  const rise = clamped <= 0.95 ? 0 : (clamped - 0.95) / 0.05;
  const y = 1.6 + 0.5 * rise;
  const look: Vec3 = {
    x: 0,
    y: clamped >= SHELF_START ? 1.4 : lerp(1.5, 1.3, clamped),
    z: clamped >= SHELF_START ? SHELF_Z : z - 30,
  };
  return { position: { x: 0, y, z }, look };
}

/** Where a given box number sits on the shelf. */
export function boxShelfPosition(number: number, columns: number): Vec3 {
  const row = Math.floor((number - 1) / columns);
  const col = (number - 1) % columns;
  const spacingX = 0.62;
  const spacingY = 0.5;
  const width = (columns - 1) * spacingX;
  return {
    x: -width / 2 + col * spacingX,
    y: 1.0 + row * spacingY,
    z: SHELF_Z,
  };
}

export function shelfColumnsFor(width: number): number {
  if (width < 768) return 6;
  if (width < 1280) return 12;
  return 20;
}

export const SHELF_ROWS = 40;
