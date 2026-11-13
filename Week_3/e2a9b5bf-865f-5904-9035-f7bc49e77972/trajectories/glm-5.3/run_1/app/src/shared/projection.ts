// The projection and its inverse, shared by browser, server and PDF (DP-79).
import { trainById, type TrainId } from "./optics.js";

export type SkyPoint = readonly [number, number]; // [east arcmin, north arcmin]

// Map a sky point to fraction-of-radius screen offsets (x right, y down)
// under the given train, for a field whose radius covers half the true field.
export function skyToScreen(point: SkyPoint, train: TrainId, trueFieldArcmin: number): { x: number; y: number } {
  const [east, north] = point;
  const info = trainById(train);
  const rad = (info.rotation_deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Naked-eye view: north up (y down = -north), east left (x = -east).
  let x = -east;
  let y = -north;
  // Rotate by the train's rotation about the centre.
  const rx = x * cos - y * sin;
  const ry = x * sin + y * cos;
  x = rx;
  y = ry;
  if (info.mirrored) x = -x;
  const halfField = Math.max(trueFieldArcmin / 2, 0.0001);
  return { x: x / halfField, y: y / halfField };
}

// Inverse of skyToScreen: screen fraction-of-radius back to sky arcminutes.
export function screenToSky(x: number, y: number, train: TrainId, trueFieldArcmin: number): SkyPoint {
  const info = trainById(train);
  const halfField = Math.max(trueFieldArcmin / 2, 0.0001);
  let sx = x * halfField;
  const sy = y * halfField;
  if (info.mirrored) sx = -sx;
  const rad = (info.rotation_deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Undo the rotation (rotate by the negative angle).
  const nx = sx * cos + sy * sin;
  const ny = -sx * sin + sy * cos;
  return [round2(-nx), round2(-ny)];
}

function round2(v: number): number {
  return Math.round((v + Number.EPSILON * Math.sign(v)) * 100) / 100;
}

export function skyDistance(a: SkyPoint, b: SkyPoint): number {
  const de = b[0] - a[0];
  const dn = b[1] - a[1];
  return Math.sqrt(de * de + dn * dn);
}

// Screen unit-vector deltas for one step of on-screen movement under a train.
// Used by the keyboard cursor: an arrow moves the cursor that way on screen,
// which is a specific direction on the sky.
export function screenStepToSky(dx: number, dy: number, train: TrainId): SkyPoint {
  return screenToSky(dx, dy, train, 2);
}
