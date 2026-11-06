/**
 * The Survey Ring viewer: WebGL rendering of the model, published camera geometry,
 * keyboard/touch control, hotspots with the caliper line, first-person mode,
 * tweens, reduced motion and the no-acceleration fallback.
 */

export const AZIMUTH_STEP = 15;
export const AZIMUTH_MIN = 0;
export const AZIMUTH_MAX = 345;
export const TILT_STEP = 5;
export const TILT_MIN = -10;
export const TILT_MAX = 80;
export const DISTANCE_STEP = 0.2;
export const DISTANCE_MIN = 1.2;
export const DISTANCE_MAX = 6;
export const FOV_STEP = 5;
export const FOV_MIN = 20;
export const FOV_MAX = 60;
export const FP_HEADING_STEP = 15;
export const FP_PITCH_MIN = -45;
export const FP_PITCH_MAX = 45;
export const FP_EYE_HEIGHT_MM = 1600;

export interface Camera {
  azimuth: number;
  tilt: number;
  distanceFactor: number;
  fov: number;
}

export interface Hotspot {
  label: string;
  x_mm: number;
  y_mm: number;
  z_mm: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function stepTo(value: number, delta: number, step: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value / step) * step + delta * step));
}

export function wrapAzimuth(azimuth: number): number {
  const wrapped = ((azimuth % 360) + 360) % 360;
  return wrapped === 360 ? 0 : wrapped;
}

export function facingAzimuth(p: Vec3): number {
  const raw = (Math.atan2(p.x, p.z) * 180) / Math.PI;
  const normalised = ((Math.round(raw / AZIMUTH_STEP) * AZIMUTH_STEP) % 360 + 360) % 360;
  return normalised === 360 ? 0 : normalised;
}

export function cameraPosition(cam: Camera, radiusMm: number): Vec3 {
  const d = cam.distanceFactor * radiusMm;
  const a = (cam.azimuth * Math.PI) / 180;
  const t = (cam.tilt * Math.PI) / 180;
  return {
    x: d * Math.cos(t) * Math.sin(a),
    y: d * Math.sin(t),
    z: d * Math.cos(t) * Math.cos(a),
  };
}

export function projectHotspot(
  p: Vec3,
  cam: Camera,
  radiusMm: number,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number } {
  const position = cameraPosition(cam, radiusMm);
  const forwardLen = Math.hypot(position.x, position.y, position.z);
  const forward: Vec3 = { x: -position.x / forwardLen, y: -position.y / forwardLen, z: -position.z / forwardLen };
  const up: Vec3 = { x: 0, y: 1, z: 0 };
  const rightLen = Math.hypot(
    forward.y * up.z - forward.z * up.y,
    forward.z * up.x - forward.x * up.z,
    forward.x * up.y - forward.y * up.x,
  );
  const right: Vec3 = {
    x: (forward.y * up.z - forward.z * up.y) / rightLen,
    y: (forward.z * up.x - forward.x * up.z) / rightLen,
    z: (forward.x * up.y - forward.y * up.x) / rightLen,
  };
  const cameraUp: Vec3 = {
    x: right.y * forward.z - right.z * forward.y,
    y: right.z * forward.x - right.x * forward.z,
    z: right.x * forward.y - right.y * forward.x,
  };
  const v: Vec3 = { x: p.x - position.x, y: p.y - position.y, z: p.z - position.z };
  const xc = v.x * right.x + v.y * right.y + v.z * right.z;
  const yc = v.x * cameraUp.x + v.y * cameraUp.y + v.z * cameraUp.z;
  const zc = v.x * forward.x + v.y * forward.y + v.z * forward.z;
  const half = Math.tan(((cam.fov / 2) * Math.PI) / 180);
  const x = (((xc / (zc * half * (canvasWidth / canvasHeight))) + 1) / 2) * canvasWidth;
  const y = ((1 - yc / (zc * half)) / 2) * canvasHeight;
  return { x, y };
}

export function ringIndexMarkCentre(azimuth: number, canvasWidth: number, canvasHeight: number): { x: number; y: number } {
  const r = Math.min(canvasWidth, canvasHeight) / 2;
  const a = (azimuth * Math.PI) / 180;
  return { x: canvasWidth / 2 + r * Math.sin(a), y: canvasHeight / 2 - r * Math.cos(a) };
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
