// Link graph camera: 4×4 column-major matrix maths, camera pose, orbit and zoom, fly-to, picking and projection.

import { FLY_MS } from './motion.ts';

export { FLY_MS };

export type Vec3 = [number, number, number];
/** 16 numbers, column-major (element 4c + r is row r of column c), ready for a Float32Array. */
export type Mat4 = number[];

export const FOV_Y_DEG = 45;
export const NEAR = 0.1;
export const FAR = 500;
export const FOG_RANGE = 40;
export const UP: Vec3 = [0, 1, 0];

export const PITCH_LIMIT_DEG = 80;
export const DISTANCE_MIN = 12;
export const DISTANCE_MAX = 90;
export const ORBIT_DEG_PER_PX = 0.4;
export const WHEEL_DISTANCE_PER_PX = 0.05;
export const KEY_YAW_DEG = 15;
export const KEY_PITCH_DEG = 10;
export const KEY_DISTANCE = 5;
export const FLY_PITCH_DEG = 15;
export const FLY_DISTANCE_BASE = 12;
export const FLY_DISTANCE_PER_SIZE = 4;
export const IDLE_DEG_PER_S = 6;
export const IDLE_RESUME_MS = 5000;
export const LABEL_OFFSET_PX = 12;
export const LABEL_DETAIL_PX = 6;
/** a press that moves this far in total is a drag, not a click */
export const DRAG_THRESHOLD_PX = 4;

const RAD = Math.PI / 180;

export function radians(deg: number): number {
  return deg * RAD;
}

export function degrees(rad: number): number {
  return rad / RAD;
}

// Vector helpers.
export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function normalize(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l === 0 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
}

// Matrices.
export function identity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** a · b */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += (a[k * 4 + r] ?? 0) * (b[c * 4 + k] ?? 0);
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

export function translate(v: Vec3): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, v[0], v[1], v[2], 1];
}

export function scale(s: number): Mat4 {
  return [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];
}

/** Model matrix translate(position) · scale(s). */
export function modelMatrix(position: Vec3, s: number): Mat4 {
  return [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, position[0], position[1], position[2], 1];
}

export function perspective(fovyRad: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovyRad / 2);
  const nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}

/** The scene projection for a canvas of the given display size. */
export function sceneProjection(width: number, height: number): Mat4 {
  return perspective(radians(FOV_Y_DEG), width / height, NEAR, FAR);
}

export function lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const z = normalize(sub(eye, target));
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
}

export function invert(m: Mat4): Mat4 | null {
  const a = (i: number): number => m[i] ?? 0;
  const inv = [
    a(5) * a(10) * a(15) - a(5) * a(11) * a(14) - a(9) * a(6) * a(15) + a(9) * a(7) * a(14) + a(13) * a(6) * a(11) - a(13) * a(7) * a(10),
    -a(1) * a(10) * a(15) + a(1) * a(11) * a(14) + a(9) * a(2) * a(15) - a(9) * a(3) * a(14) - a(13) * a(2) * a(11) + a(13) * a(3) * a(10),
    a(1) * a(6) * a(15) - a(1) * a(7) * a(14) - a(5) * a(2) * a(15) + a(5) * a(3) * a(14) + a(13) * a(2) * a(7) - a(13) * a(3) * a(6),
    -a(1) * a(6) * a(11) + a(1) * a(7) * a(10) + a(5) * a(2) * a(11) - a(5) * a(3) * a(10) - a(9) * a(2) * a(7) + a(9) * a(3) * a(6),
    -a(4) * a(10) * a(15) + a(4) * a(11) * a(14) + a(8) * a(6) * a(15) - a(8) * a(7) * a(14) - a(12) * a(6) * a(11) + a(12) * a(7) * a(10),
    a(0) * a(10) * a(15) - a(0) * a(11) * a(14) - a(8) * a(2) * a(15) + a(8) * a(3) * a(14) + a(12) * a(2) * a(11) - a(12) * a(3) * a(10),
    -a(0) * a(6) * a(15) + a(0) * a(7) * a(14) + a(4) * a(2) * a(15) - a(4) * a(3) * a(14) - a(12) * a(2) * a(7) + a(12) * a(3) * a(6),
    a(0) * a(6) * a(11) - a(0) * a(7) * a(10) - a(4) * a(2) * a(11) + a(4) * a(3) * a(10) + a(8) * a(2) * a(7) - a(8) * a(3) * a(6),
    a(4) * a(9) * a(15) - a(4) * a(11) * a(13) - a(8) * a(5) * a(15) + a(8) * a(7) * a(13) + a(12) * a(5) * a(11) - a(12) * a(7) * a(9),
    -a(0) * a(9) * a(15) + a(0) * a(11) * a(13) + a(8) * a(1) * a(15) - a(8) * a(3) * a(13) - a(12) * a(1) * a(11) + a(12) * a(3) * a(9),
    a(0) * a(5) * a(15) - a(0) * a(7) * a(13) - a(4) * a(1) * a(15) + a(4) * a(3) * a(13) + a(12) * a(1) * a(7) - a(12) * a(3) * a(5),
    -a(0) * a(5) * a(11) + a(0) * a(7) * a(9) + a(4) * a(1) * a(11) - a(4) * a(3) * a(9) - a(8) * a(1) * a(7) + a(8) * a(3) * a(5),
    -a(4) * a(9) * a(14) + a(4) * a(10) * a(13) + a(8) * a(5) * a(14) - a(8) * a(6) * a(13) - a(12) * a(5) * a(10) + a(12) * a(6) * a(9),
    a(0) * a(9) * a(14) - a(0) * a(10) * a(13) - a(8) * a(1) * a(14) + a(8) * a(2) * a(13) + a(12) * a(1) * a(10) - a(12) * a(2) * a(9),
    -a(0) * a(5) * a(14) + a(0) * a(6) * a(13) + a(4) * a(1) * a(14) - a(4) * a(2) * a(13) - a(12) * a(1) * a(6) + a(12) * a(2) * a(5),
    a(0) * a(5) * a(10) - a(0) * a(6) * a(9) - a(4) * a(1) * a(10) + a(4) * a(2) * a(9) + a(8) * a(1) * a(6) - a(8) * a(2) * a(5),
  ];
  const det = a(0) * (inv[0] ?? 0) + a(1) * (inv[4] ?? 0) + a(2) * (inv[8] ?? 0) + a(3) * (inv[12] ?? 0);
  if (det === 0) return null;
  return inv.map((v) => v / det);
}

function transform(m: Mat4, p: readonly [number, number, number, number]): [number, number, number, number] {
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) {
    out[r] = (m[r] ?? 0) * p[0] + (m[4 + r] ?? 0) * p[1] + (m[8 + r] ?? 0) * p[2] + (m[12 + r] ?? 0) * p[3];
  }
  return out;
}

// Camera pose.
export interface CameraPose {
  target: Vec3;
  /** ψ in degrees */
  yaw: number;
  /** φ in degrees */
  pitch: number;
  distance: number;
}

export const HOME_POSE: CameraPose = { target: [0, 0, 0], yaw: 0, pitch: 20, distance: 40 };

export function eyeOf(pose: CameraPose): Vec3 {
  const psi = radians(pose.yaw);
  const phi = radians(pose.pitch);
  const c = pose.target;
  const d = pose.distance;
  return [c[0] + d * Math.cos(phi) * Math.sin(psi), c[1] + d * Math.sin(phi), c[2] + d * Math.cos(phi) * Math.cos(psi)];
}

export function viewMatrix(pose: CameraPose): Mat4 {
  return lookAt(eyeOf(pose), pose.target, UP);
}

export function fogFar(distance: number): number {
  return distance + FOG_RANGE;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function clampPose(pose: CameraPose): CameraPose {
  return {
    target: pose.target,
    yaw: pose.yaw,
    pitch: clamp(pose.pitch, -PITCH_LIMIT_DEG, PITCH_LIMIT_DEG),
    distance: clamp(pose.distance, DISTANCE_MIN, DISTANCE_MAX),
  };
}

/** Drag on empty canvas: right raises yaw, down raises pitch. */
export function orbit(pose: CameraPose, dxPx: number, dyPx: number): CameraPose {
  return clampPose({ ...pose, yaw: pose.yaw + ORBIT_DEG_PER_PX * dxPx, pitch: pose.pitch + ORBIT_DEG_PER_PX * dyPx });
}

/** Wheel over the canvas, deltaY already in pixels. */
export function zoom(pose: CameraPose, deltaYPx: number): CameraPose {
  return clampPose({ ...pose, distance: pose.distance + WHEEL_DISTANCE_PER_PX * deltaYPx });
}

/** Key on a node button; null when the key does not move the camera. */
export function applyCameraKey(pose: CameraPose, key: string, shiftKey: boolean): CameraPose | null {
  if (shiftKey) {
    if (key === 'ArrowLeft') return clampPose({ ...pose, yaw: pose.yaw - KEY_YAW_DEG });
    if (key === 'ArrowRight') return clampPose({ ...pose, yaw: pose.yaw + KEY_YAW_DEG });
    if (key === 'ArrowUp') return clampPose({ ...pose, pitch: pose.pitch + KEY_PITCH_DEG });
    if (key === 'ArrowDown') return clampPose({ ...pose, pitch: pose.pitch - KEY_PITCH_DEG });
  }
  if (key === '+' || key === '=') return clampPose({ ...pose, distance: pose.distance - KEY_DISTANCE });
  if (key === '-') return clampPose({ ...pose, distance: pose.distance + KEY_DISTANCE });
  return null;
}

export function idleTurn(pose: CameraPose, elapsedMs: number): CameraPose {
  return { ...pose, yaw: pose.yaw + (IDLE_DEG_PER_S * elapsedMs) / 1000 };
}

/** The angle equal to `deg` modulo 360 that lies nearest `from`. */
export function nearestAngle(from: number, deg: number): number {
  const diff = (((deg - from + 180) % 360) + 360) % 360 - 180;
  return from + diff;
}

/** Fly-to pose for a node at `position` with size `s`, reached the short way round from `currentYaw`. */
export function flyTarget(position: Vec3, s: number, currentYaw: number): CameraPose {
  return {
    target: [position[0], position[1], position[2]],
    yaw: nearestAngle(currentYaw, degrees(Math.atan2(position[0], position[2]))),
    pitch: FLY_PITCH_DEG,
    distance: FLY_DISTANCE_BASE + FLY_DISTANCE_PER_SIZE * s,
  };
}

/** The home pose, reached the short way round from `currentYaw`. */
export function flyHome(currentYaw: number): CameraPose {
  return { ...HOME_POSE, target: [...HOME_POSE.target], yaw: nearestAngle(currentYaw, HOME_POSE.yaw) };
}

export function interpolatePose(from: CameraPose, to: CameraPose, e: number): CameraPose {
  const lerp = (a: number, b: number): number => a + (b - a) * e;
  return {
    target: [lerp(from.target[0], to.target[0]), lerp(from.target[1], to.target[1]), lerp(from.target[2], to.target[2])],
    yaw: lerp(from.yaw, to.yaw),
    pitch: lerp(from.pitch, to.pitch),
    distance: lerp(from.distance, to.distance),
  };
}

// Labels, projection and picking.
export function projectedRadius(s: number, canvasHeight: number, eyeDepth: number): number {
  return (s * (canvasHeight / 2)) / (Math.tan(radians(FOV_Y_DEG / 2)) * eyeDepth);
}

export interface Projected {
  x: number;
  y: number;
  /** positive eye-space depth; not positive when behind the camera */
  depth: number;
}

/** Point in canvas display pixels from the canvas's top-left corner. */
export function project(point: Vec3, view: Mat4, projection: Mat4, width: number, height: number): Projected {
  const eye = transform(view, [point[0], point[1], point[2], 1]);
  const clip = transform(projection, eye);
  return {
    x: (clip[0] / clip[3] + 1) / 2 * width,
    y: (1 - clip[1] / clip[3]) / 2 * height,
    depth: -eye[2],
  };
}

export interface LabelState {
  s: number;
  projected: Projected;
  width: number;
  height: number;
  selected: boolean;
  focused: boolean;
}

/** A label's detail factor: 1 shows the text, 0 hides it. */
export function detailFactor(label: LabelState): number {
  if (label.focused) return 1;
  const p = label.projected;
  if (p.depth <= 0 || p.x < 0 || p.x > label.width || p.y < 0 || p.y > label.height) return 0;
  if (label.selected) return 1;
  return projectedRadius(label.s, label.height, p.depth) >= LABEL_DETAIL_PX ? 1 : 0;
}

export interface Ray {
  origin: Vec3;
  dir: Vec3;
}

/** The ray from the eye through display pixel (x, y); null when the matrices are singular. */
export function screenRay(x: number, y: number, width: number, height: number, view: Mat4, projection: Mat4): Ray | null {
  const inv = invert(multiply(projection, view));
  if (inv === null) return null;
  const nx = (2 * x) / width - 1;
  const ny = 1 - (2 * y) / height;
  const a = transform(inv, [nx, ny, -1, 1]);
  const b = transform(inv, [nx, ny, 1, 1]);
  const near: Vec3 = [a[0] / a[3], a[1] / a[3], a[2] / a[3]];
  const far: Vec3 = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
  return { origin: near, dir: normalize(sub(far, near)) };
}

export interface PickTarget {
  id: string;
  pos: Vec3;
  s: number;
}

export interface PickHit {
  id: string;
  distance: number;
}

/** Nearest node sphere (radius s) hit by the ray, or null. */
export function pickNode(rayOrigin: Vec3, rayDir: Vec3, nodes: readonly PickTarget[]): PickHit | null {
  const d = normalize(rayDir);
  let best: PickHit | null = null;
  for (const node of nodes) {
    const oc = sub(rayOrigin, node.pos);
    const b = dot(oc, d);
    const disc = b * b - (dot(oc, oc) - node.s * node.s);
    if (disc < 0) continue;
    const root = Math.sqrt(disc);
    const t = -b - root >= 0 ? -b - root : -b + root;
    if (t < 0) continue;
    if (best === null || t < best.distance) best = { id: node.id, distance: t };
  }
  return best;
}

/** Where the ray meets the plane through `point` with normal `normal`; null when parallel or behind. */
export function rayPlane(rayOrigin: Vec3, rayDir: Vec3, point: Vec3, normal: Vec3): Vec3 | null {
  const denom = dot(rayDir, normal);
  if (Math.abs(denom) < 1e-12) return null;
  const t = dot(sub(point, rayOrigin), normal) / denom;
  if (t < 0) return null;
  return [rayOrigin[0] + rayDir[0] * t, rayOrigin[1] + rayDir[1] * t, rayOrigin[2] + rayDir[2] * t];
}
