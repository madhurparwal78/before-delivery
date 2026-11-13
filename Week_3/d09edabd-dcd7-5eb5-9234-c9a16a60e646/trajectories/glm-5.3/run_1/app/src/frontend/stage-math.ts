import type { Placement, Room } from '../shared/types.js';

export interface Camera {
  yaw: number;   // 0..359
  pitch: number; // 5..80
  distance: number;
  targetY: number;
}

export type StageMode = 'overview' | 'walking-in' | 'player';

export const OVERVIEW_START: Camera = { yaw: 30, pitch: 35, distance: 6500, targetY: 900 };

/** Player-height start pose: 1.6 m up, 0.8 m inside the door, facing into the room. */
export function playerPose(room: Room, placements: Placement[]): { x: number; z: number; yaw: number } {
  const door = placements.find((p) => p.kind === 'door' && p.entry) ?? placements.find((p) => p.kind === 'door');
  if (door) {
    return { x: door.xMm + door.widthMm / 2, z: Math.min(800, room.depthMm), yaw: 180 };
  }
  return { x: room.widthMm / 2, z: 800, yaw: 180 };
}

/** WebGL support probe, cached. */
let webglOk: boolean | null = null;
export function hasWebGL(): boolean {
  if (webglOk !== null) return webglOk;
  try {
    const c = document.createElement('canvas');
    webglOk = !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    webglOk = false;
  }
  return webglOk;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface Mat4 { m: Float32Array }

export function mat4Identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return { m };
}

export function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f;
  m[10] = (far + near) / (near - far); m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return { m };
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      out[j * 4 + i] =
        a.m[0 * 4 + i] * b.m[j * 4 + 0] +
        a.m[1 * 4 + i] * b.m[j * 4 + 1] +
        a.m[2 * 4 + i] * b.m[j * 4 + 2] +
        a.m[3 * 4 + i] * b.m[j * 4 + 3];
    }
  }
  return { m: out };
}

export function translate(x: number, y: number, z: number): Mat4 {
  const { m } = mat4Identity();
  m[12] = x; m[13] = y; m[14] = z;
  return { m };
}

export function rotateY(deg: number): Mat4 {
  const { m } = mat4Identity();
  const r = (deg * Math.PI) / 180;
  m[0] = Math.cos(r); m[2] = -Math.sin(r);
  m[8] = Math.sin(r); m[10] = Math.cos(r);
  return { m };
}

export function scale(x: number, y: number, z: number): Mat4 {
  const { m } = mat4Identity();
  m[0] = x; m[5] = y; m[10] = z;
  return { m };
}

export function cameraMatrix(cam: { x: number; y: number; z: number; yaw: number; pitch: number }): Mat4 {
  const rot = multiply(rotateY(-cam.yaw), (() => {
    const { m } = mat4Identity();
    const r = (-cam.pitch * Math.PI) / 180;
    m[5] = Math.cos(r); m[6] = Math.sin(r);
    m[9] = -Math.sin(r); m[10] = Math.cos(r);
    return { m };
  })());
  const view = multiply(rot, translate(-cam.x, -cam.y, -cam.z));
  return view;
}

/** Orbit camera to a view matrix for the overview pose. */
export function orbitView(cam: Camera, target: { x: number; z: number }): Mat4 {
  const yaw = (cam.yaw * Math.PI) / 180;
  const pitch = (cam.pitch * Math.PI) / 180;
  const d = cam.distance;
  const x = target.x - Math.sin(yaw) * Math.cos(pitch) * d;
  const z = target.z - Math.cos(yaw) * Math.cos(pitch) * d;
  const y = cam.targetY + Math.sin(pitch) * d;
  return cameraMatrix({ x, y, z, yaw: cam.yaw, pitch: cam.pitch });
}

export function playerView(p: { x: number; y: number; z: number; yaw: number; pitch?: number }): Mat4 {
  return cameraMatrix({ x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch ?? 0 });
}

/** Project a world point to CSS pixels for markers. */
export function projectPoint(point: { x: number; y: number; z: number }, view: Mat4, proj: Mat4, w: number, h: number): { x: number; y: number; visible: boolean } {
  const m = multiply(proj, view).m;
  const px = point.x, py = point.y, pz = point.z;
  const cx = m[0] * px + m[4] * py + m[8] * pz + m[12];
  const cy = m[1] * px + m[5] * py + m[9] * pz + m[13];
  const cw = m[3] * px + m[7] * py + m[11] * pz + m[15];
  if (cw <= 0.01) return { x: 0, y: 0, visible: false };
  return { x: ((cx / cw + 1) / 2) * w, y: ((1 - cy / cw) / 2) * h, visible: true };
}
