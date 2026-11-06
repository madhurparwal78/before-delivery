/**
 * The published viewer geometry. The server validates saved views against it
 * and renders the first paint from it; the browser steps the camera with it.
 */

export const AZIMUTH_STEP = 15;
export const TILT_STEP = 5;
export const TILT_MIN = -10;
export const TILT_MAX = 80;
export const DISTANCE_STEP = 0.2;
export const DISTANCE_MIN = 1.2;
export const DISTANCE_MAX = 6;
export const FOV_STEP = 5;
export const FOV_MIN = 20;
export const FOV_MAX = 60;
export const HEADING_STEP = 15;
export const PITCH_STEP = 5;
export const PITCH_MIN = -45;
export const PITCH_MAX = 45;
export const MAX_HOTSPOTS = 8;
/** Standing eye height in millimetres at 1:1, divided by the scale denominator. */
export const EYE_HEIGHT_MM_AT_1_1 = 1600;
/** Whole pixels of drag travel that make one azimuth or tilt step. */
export const DRAG_PIXELS_PER_STEP = 24;
/** Whole percent of pinch spread change that makes one distance step. */
export const PINCH_PERCENT_PER_STEP = 10;
export const RING_TICKS = 72;
export const RING_TICK_DEGREES = 5;

export interface Camera {
  azimuth: number;
  tilt: number;
  /** The distance factor k, a multiple of the bounding radius. */
  distance: number;
  fov: number;
}

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Hotspot {
  readonly label: string;
  readonly x_mm: number;
  readonly y_mm: number;
  readonly z_mm: number;
}

/** Rounds to 0.1, the precision every published number carries. */
export function round1(value: number): number {
  const r = Math.round(value * 10) / 10;
  return r === 0 ? 0 : r;
}

/** A published attribute value: rounded to 0.1 with a dot decimal. */
export function attrNum(value: number): string {
  return String(round1(value));
}

export function wrapAzimuth(degrees: number): number {
  const m = degrees % 360;
  return m < 0 ? m + 360 : m;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Azimuth wraps; it has no limit to stop at. */
export function stepAzimuth(azimuth: number, steps: number): number {
  return wrapAzimuth(azimuth + steps * AZIMUTH_STEP);
}

/** Tilt, distance and field of view stop at their limits. */
export function stepTilt(tilt: number, steps: number): number {
  return clamp(round1(tilt + steps * TILT_STEP), TILT_MIN, TILT_MAX);
}

export function stepDistance(distance: number, steps: number): number {
  return clamp(round1(distance + steps * DISTANCE_STEP), DISTANCE_MIN, DISTANCE_MAX);
}

export function stepFov(fov: number, steps: number): number {
  return clamp(round1(fov + steps * FOV_STEP), FOV_MIN, FOV_MAX);
}

export function stepHeading(heading: number, steps: number): number {
  return wrapAzimuth(heading + steps * HEADING_STEP);
}

export function stepPitch(pitch: number, steps: number): number {
  return clamp(round1(pitch + steps * PITCH_STEP), PITCH_MIN, PITCH_MAX);
}

function onStep(value: number, step: number, origin: number): boolean {
  const offset = (value - origin) / step;
  return Math.abs(offset - Math.round(offset)) < 1e-6;
}

/** A saved camera must sit on step and inside the limits. */
export function isValidCamera(camera: Camera): boolean {
  const { azimuth, tilt, distance, fov } = camera;
  if (![azimuth, tilt, distance, fov].every((n) => Number.isFinite(n))) return false;
  if (azimuth < 0 || azimuth > 345 || !onStep(azimuth, AZIMUTH_STEP, 0)) return false;
  if (tilt < TILT_MIN || tilt > TILT_MAX || !onStep(tilt, TILT_STEP, TILT_MIN)) return false;
  if (
    distance < DISTANCE_MIN - 1e-9 ||
    distance > DISTANCE_MAX + 1e-9 ||
    !onStep(distance, DISTANCE_STEP, DISTANCE_MIN)
  ) {
    return false;
  }
  if (fov < FOV_MIN || fov > FOV_MAX || !onStep(fov, FOV_STEP, FOV_MIN)) return false;
  return true;
}

const DEG = Math.PI / 180;

/** The camera distance D in millimetres, from the factor k and the radius. */
export function cameraDistanceMm(distanceFactor: number, boundingRadiusMm: number): number {
  return distanceFactor * boundingRadiusMm;
}

/** Camera position relative to the bounding-box centre, in millimetres. */
export function cameraPosition(camera: Camera, boundingRadiusMm: number): Vec3 {
  const d = cameraDistanceMm(camera.distance, boundingRadiusMm);
  const t = camera.tilt * DEG;
  const a = camera.azimuth * DEG;
  return {
    x: d * Math.cos(t) * Math.sin(a),
    y: d * Math.sin(t),
    z: d * Math.cos(t) * Math.cos(a),
  };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function normalise(v: Vec3): Vec3 {
  const len = Math.sqrt(dot(v, v));
  return len === 0 ? v : { x: v.x / len, y: v.y / len, z: v.z / len };
}

const WORLD_UP: Vec3 = { x: 0, y: 1, z: 0 };

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** Projects a hotspot, in millimetres relative to the box centre, to canvas pixels. */
export function projectHotspot(
  point: Vec3,
  camera: Camera,
  boundingRadiusMm: number,
  width: number,
  height: number,
): ScreenPoint {
  const position = cameraPosition(camera, boundingRadiusMm);
  const forward = normalise({ x: -position.x, y: -position.y, z: -position.z });
  const right = normalise(cross(forward, WORLD_UP));
  const cameraUp = cross(right, forward);
  const v = sub(point, position);
  const xc = dot(v, right);
  const yc = dot(v, cameraUp);
  const zc = dot(v, forward);
  const halfFov = Math.tan((camera.fov / 2) * DEG);
  const x = ((xc / (zc * halfFov * (width / height)) + 1) / 2) * width;
  const y = ((1 - yc / (zc * halfFov)) / 2) * height;
  return { x: round1(x), y: round1(y) };
}

/**
 * The azimuth the camera turns to for a hotspot: atan2(p.x, p.z), normalised,
 * rounded to the nearest 15 with halves rounding up, and 360 becoming 0.
 */
export function azimuthForHotspot(point: Vec3): number {
  const raw = wrapAzimuth((Math.atan2(point.x, point.z) * 180) / Math.PI);
  const snapped = Math.floor(raw / AZIMUTH_STEP + 0.5) * AZIMUTH_STEP;
  return snapped % 360;
}

/** The ring's index-mark centre, for a canvas of width W and height H. */
export function ringIndexPoint(azimuth: number, width: number, height: number): ScreenPoint {
  const r = Math.min(width, height) / 2;
  const a = azimuth * DEG;
  return {
    x: round1(width / 2 + r * Math.sin(a)),
    y: round1(height / 2 - r * Math.cos(a)),
  };
}

export function ringRadius(width: number, height: number): number {
  return Math.min(width, height) / 2;
}

/** The heading the eye starts on in first-person mode: facing the box centre. */
export function initialHeading(azimuth: number): number {
  return wrapAzimuth(azimuth + 180);
}

/** The eye height above the box's lowest point, in millimetres. */
export function eyeHeightMm(scaleDenominator: number): number {
  return round1(EYE_HEIGHT_MM_AT_1_1 / scaleDenominator);
}

/** The published tick degrees, 0, 5, … 355. */
export function ringTickDegrees(): readonly number[] {
  return Array.from({ length: RING_TICKS }, (_, i) => i * RING_TICK_DEGREES);
}

/** Whole steps from accumulated drag travel in pixels. */
export function stepsFromDrag(travelPixels: number): number {
  return Math.trunc(travelPixels / DRAG_PIXELS_PER_STEP);
}
