import type { Point } from "./types";

/**
 * The one projection: the naked-eye view (north up, east left), rotated by the train's
 * rotation, then mirrored left-to-right when the train is mirrored. Positions are in
 * arcminutes with x to the right and y up on screen.
 */
interface Orient {
  rotation_deg: number;
  mirrored: boolean;
}

/**
 * Sky position to the view: rotate the naked-eye position by `rotationDeg`, then scale x by
 * `xFactor` (1 as seen, -1 mirrored, anything between while a flip is animating).
 */
export function projectSky(east: number, north: number, rotationDeg: number, xFactor: number): Point {
  const a = (rotationDeg * Math.PI) / 180;
  const nx = -east;
  const x = nx * Math.cos(a) - north * Math.sin(a);
  const y = nx * Math.sin(a) + north * Math.cos(a);
  return [x * xFactor, y];
}

export function skyToView(east: number, north: number, orient: Orient): Point {
  return projectSky(east, north, orient.rotation_deg, orient.mirrored ? -1 : 1);
}

export function viewToSky(x: number, y: number, orient: Orient): Point {
  const a = (-orient.rotation_deg * Math.PI) / 180;
  const ux = orient.mirrored ? -x : x;
  const nx = ux * Math.cos(a) - y * Math.sin(a);
  const north = ux * Math.sin(a) + y * Math.cos(a);
  return [-nx, north];
}

export function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

export function roundPoint(p: Point): Point {
  return [round2(p[0]), round2(p[1])];
}

export function hasTwoDecimals(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-7;
}

/** Moves a sky position along its radius to the circle's edge when it lies outside it. */
export function clampToField(point: Point, fieldArcmin: number): Point {
  const radius = fieldArcmin / 2;
  const distance = Math.hypot(point[0], point[1]);
  if (distance <= radius) return point;
  const k = radius / distance;
  return roundPoint([point[0] * k, point[1] * k]);
}
