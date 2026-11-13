import type { Vec3 } from './types';

/** Column-major 4x4 matrix, the layout WebGL expects. */
export type Mat4 = number[];

export interface Transform {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

export interface Camera {
  position: Vec3;
  target: Vec3;
  fov: number;
  near: number;
  far: number;
}

export interface Artboard {
  width: number;
  height: number;
}

const radians = (degrees: number): number => (degrees * Math.PI) / 180;

export const vec = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const add = (a: Vec3, b: Vec3): Vec3 => vec(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => vec(a.x - b.x, a.y - b.y, a.z - b.z);
const scaleBy = (a: Vec3, s: number): Vec3 => vec(a.x * s, a.y * s, a.z * s);
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const normalise = (a: Vec3): Vec3 => {
  const l = length(a);
  return l === 0 ? a : scaleBy(a, 1 / l);
};

/** v' = T·Rz·Ry·Rx·S·v with angles in degrees. */
export function toWorld(local: Vec3, transform: Transform): Vec3 {
  const scaled = vec(local.x * transform.scale.x, local.y * transform.scale.y, local.z * transform.scale.z);
  const a = radians(transform.rotation.x);
  const afterX = vec(scaled.x, scaled.y * Math.cos(a) - scaled.z * Math.sin(a), scaled.y * Math.sin(a) + scaled.z * Math.cos(a));
  const b = radians(transform.rotation.y);
  const afterY = vec(afterX.x * Math.cos(b) + afterX.z * Math.sin(b), afterX.y, -afterX.x * Math.sin(b) + afterX.z * Math.cos(b));
  const c = radians(transform.rotation.z);
  const afterZ = vec(afterY.x * Math.cos(c) - afterY.y * Math.sin(c), afterY.x * Math.sin(c) + afterY.y * Math.cos(c), afterY.z);
  return add(afterZ, transform.position);
}

/** Inverse of `toWorld`: a world point made local to the transform. */
export function toLocal(world: Vec3, transform: Transform): Vec3 {
  const moved = sub(world, transform.position);
  const c = radians(-transform.rotation.z);
  const afterZ = vec(moved.x * Math.cos(c) - moved.y * Math.sin(c), moved.x * Math.sin(c) + moved.y * Math.cos(c), moved.z);
  const b = radians(-transform.rotation.y);
  const afterY = vec(afterZ.x * Math.cos(b) + afterZ.z * Math.sin(b), afterZ.y, -afterZ.x * Math.sin(b) + afterZ.z * Math.cos(b));
  const a = radians(-transform.rotation.x);
  const afterX = vec(afterY.x, afterY.y * Math.cos(a) - afterY.z * Math.sin(a), afterY.y * Math.sin(a) + afterY.z * Math.cos(a));
  return vec(afterX.x / transform.scale.x, afterX.y / transform.scale.y, afterX.z / transform.scale.z);
}

export function modelMatrix(transform: Transform): Mat4 {
  const origin = toWorld(vec(0, 0, 0), transform);
  const columns = [vec(1, 0, 0), vec(0, 1, 0), vec(0, 0, 1)].map((axis) => sub(toWorld(axis, transform), origin));
  return [
    ...[columns[0], columns[1], columns[2]].flatMap((c) => [(c as Vec3).x, (c as Vec3).y, (c as Vec3).z, 0]),
    origin.x,
    origin.y,
    origin.z,
    1,
  ];
}

interface Basis {
  right: Vec3;
  up: Vec3;
  forward: Vec3;
}

function basisOf(camera: Camera): Basis {
  const forward = normalise(sub(camera.target, camera.position));
  const right = normalise(cross(forward, vec(0, 1, 0)));
  const up = cross(right, forward);
  return { right, up, forward };
}

/** View = lookAt(position, target, up (0, 1, 0)). */
export function viewMatrix(camera: Camera): Mat4 {
  const { right, up, forward } = basisOf(camera);
  const p = camera.position;
  return [
    right.x,
    up.x,
    -forward.x,
    0,
    right.y,
    up.y,
    -forward.y,
    0,
    right.z,
    up.z,
    -forward.z,
    0,
    -dot(right, p),
    -dot(up, p),
    dot(forward, p),
    1,
  ];
}

export function projectionMatrix(camera: Camera, artboard: Artboard): Mat4 {
  const f = 1 / Math.tan(radians(camera.fov) / 2);
  const aspect = artboard.width / artboard.height;
  const { near, far } = camera;
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
}

/** The camera turned to `azimuth` degrees around its target, keeping its horizontal distance and height. */
export function orbitCamera(camera: Camera, azimuth: number): Camera {
  const offset = sub(camera.position, camera.target);
  const distance = Math.hypot(offset.x, offset.z);
  const a = radians(azimuth);
  return {
    ...camera,
    position: vec(camera.target.x + distance * Math.sin(a), camera.position.y, camera.target.z + distance * Math.cos(a)),
  };
}

/** Artboard pixels for a world point, or null when it lies outside the near and far planes. */
export function projectPoint(world: Vec3, camera: Camera, artboard: Artboard): { x: number; y: number } | null {
  const { right, up, forward } = basisOf(camera);
  const d = sub(world, camera.position);
  const xc = dot(right, d);
  const yc = dot(up, d);
  const depth = dot(forward, d);
  if (depth < camera.near || depth > camera.far) return null;
  const f = 1 / Math.tan(radians(camera.fov) / 2);
  const aspect = artboard.width / artboard.height;
  const ndcX = ((f / aspect) * xc) / depth;
  const ndcY = (f * yc) / depth;
  return { x: ((ndcX + 1) / 2) * artboard.width, y: ((1 - ndcY) / 2) * artboard.height };
}
