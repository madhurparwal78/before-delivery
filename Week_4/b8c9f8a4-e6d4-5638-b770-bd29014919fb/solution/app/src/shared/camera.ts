// The one camera. The stage, the stage preview and the drawn still all read it, so a world point
// projected through `viewProjection` lands where the picture shows it.

import type { Vec3 } from './panels.js';

const FOV_Y_DEGREES = 38;
const NEAR = 0.1;
const FAR = 120;
/** The car sits around this point, so the eye's azimuth is atan2(x, -z). */
const ORBIT_CENTRE: Vec3 = [0, 0.75, 0];

interface CameraSpec {
  /** Degrees, continuous: it may run past 360 so it never falls on forward scrolling. */
  readonly angle: number;
  readonly elevation: number;
  readonly anchor: Vec3;
  /** Where the anchor must land on the canvas, in normalised device coordinates. */
  readonly ndc: readonly [number, number];
  /** What the eye orbits. The stage orbits the car, so its azimuth is the published angle; the
   *  preview orbits the point it rests on, so a moved pin moves the camera. */
  readonly centre?: Vec3;
  /** How far the eye sits from the centre, when the whole car need not fit. */
  readonly distance?: number;
}

export interface CameraFrame {
  readonly eye: Vec3;
  readonly angle: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly viewProjection: number[];
  readonly view: number[];
  readonly projection: number[];
}

const RAD = Math.PI / 180;

/**
 * Where the point the stage rests on lands on the canvas. It sits above the middle so the
 * statements and the asking summary card frame it without covering it. Below the staircase's
 * 1200px width the frame is too narrow for the body to stand in the middle of it with the hero
 * dead centre, so the hero sits a little to the nearside and the whole car keeps even margins.
 */
export function restingNdc(width: number): readonly [number, number] {
  return [width < 1200 ? -0.16 : 0, width < 768 ? 0.26 : 0.3];
}

/** Half the body's height and half its length, each with the margin the stage leaves around it. */
const FIT_HEIGHT = 2.85;
const FIT_LENGTH = 2.9;

/** Far enough back for the whole body to stand inside the frame: a narrow frame runs out of room
 *  across the car's length first, so the margin grows as the screen narrows. */
export function distanceFor(aspect: number): number {
  return Math.max(FIT_HEIGHT, FIT_LENGTH / aspect) / Math.tan((FOV_Y_DEGREES / 2) * RAD);
}

function eyeFor(
  angle: number,
  elevation: number,
  aspect: number,
  centre: Vec3 = ORBIT_CENTRE,
  distance = distanceFor(aspect),
): Vec3 {
  const a = angle * RAD;
  const e = elevation * RAD;
  return [
    centre[0] + distance * Math.sin(a) * Math.cos(e),
    centre[1] + distance * Math.sin(e),
    centre[2] - distance * Math.cos(a) * Math.cos(e),
  ];
}

function basis(yaw: number, pitch: number): { right: Vec3; up: Vec3; forward: Vec3 } {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return {
    right: [cy, 0, -sy],
    up: [sp * sy, cp, sp * cy],
    forward: [-cp * sy, sp, -cp * cy],
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Orientation with no roll (the camera's right stays horizontal) that puts `anchor` at `ndc`.
 * Solved by correcting the yaw and pitch angles until the projected point matches; the
 * correction is exact in one axis at a time, so a handful of passes settle on the answer.
 */
function solveOrientation(
  eye: Vec3,
  anchor: Vec3,
  ndc: readonly [number, number],
  aspect: number,
): { yaw: number; pitch: number } {
  const dx = anchor[0] - eye[0];
  const dy = anchor[1] - eye[1];
  const dz = anchor[2] - eye[2];
  const length = Math.hypot(dx, dy, dz) || 1;
  const direction: Vec3 = [dx / length, dy / length, dz / length];
  const tan = Math.tan((FOV_Y_DEGREES / 2) * RAD);
  const wantX = Math.atan(ndc[0] * aspect * tan);
  const wantY = Math.atan(ndc[1] * tan);

  let yaw = Math.atan2(-direction[0], -direction[2]);
  let pitch = Math.asin(Math.max(-1, Math.min(1, direction[1])));
  for (let pass = 0; pass < 24; pass += 1) {
    const frame = basis(yaw, pitch);
    const forward = dot(direction, frame.forward);
    if (forward <= 1e-6) break;
    const haveX = Math.atan(dot(direction, frame.right) / forward);
    const haveY = Math.atan(dot(direction, frame.up) / forward);
    const stepYaw = wantX - haveX;
    const stepPitch = haveY - wantY;
    yaw += stepYaw;
    pitch += stepPitch;
    if (Math.abs(stepYaw) < 1e-12 && Math.abs(stepPitch) < 1e-12) break;
  }
  return { yaw, pitch };
}

function perspective(aspect: number): number[] {
  const f = 1 / Math.tan((FOV_Y_DEGREES / 2) * RAD);
  const range = 1 / (NEAR - FAR);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (FAR + NEAR) * range, -1,
    0, 0, 2 * FAR * NEAR * range, 0,
  ];
}

function viewMatrix(eye: Vec3, yaw: number, pitch: number): number[] {
  const { right, up, forward } = basis(yaw, pitch);
  // The view matrix is the inverse of the camera's world matrix: rows are the camera axes.
  const back: Vec3 = [-forward[0], -forward[1], -forward[2]];
  return [
    right[0], up[0], back[0], 0,
    right[1], up[1], back[1], 0,
    right[2], up[2], back[2], 0,
    -dot(right, eye), -dot(up, eye), -dot(back, eye), 1,
  ];
}

function multiply(a: number[], b: number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let total = 0;
      for (let k = 0; k < 4; k += 1) total += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = total;
    }
  }
  return out;
}

export function buildCamera(spec: CameraSpec, width: number, height: number): CameraFrame {
  const aspect = Math.max(0.05, width / Math.max(1, height));
  const eye = eyeFor(spec.angle, spec.elevation, aspect, spec.centre ?? ORBIT_CENTRE,
    spec.distance ?? distanceFor(aspect));
  const { yaw, pitch } = solveOrientation(eye, spec.anchor, spec.ndc, aspect);
  const projection = perspective(aspect);
  const view = viewMatrix(eye, yaw, pitch);
  return { eye, angle: spec.angle, yaw, pitch, projection, view, viewProjection: multiply(projection, view) };
}

/** Where a world point lands inside a box of `width` x `height` CSS pixels. */
export function project(
  viewProjection: number[],
  point: Vec3,
  width: number,
  height: number,
): { x: number; y: number; w: number } {
  const m = viewProjection;
  const x = m[0] * point[0] + m[4] * point[1] + m[8] * point[2] + m[12];
  const y = m[1] * point[0] + m[5] * point[1] + m[9] * point[2] + m[13];
  const w = m[3] * point[0] + m[7] * point[1] + m[11] * point[2] + m[15];
  return { x: ((x / w) + 1) / 2 * width, y: (1 - y / w) / 2 * height, w };
}

export function formatMatrix(values: number[]): string {
  return values.map((value) => value.toFixed(6)).join(',');
}

export function formatPoint(point: Vec3): string {
  return point.map((value) => value.toFixed(3)).join(',');
}
