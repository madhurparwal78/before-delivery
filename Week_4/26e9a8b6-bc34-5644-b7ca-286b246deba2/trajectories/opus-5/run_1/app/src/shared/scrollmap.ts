/**
 * The published scroll mapping. The reader page is a header section, one
 * section per step and a closing section, each exactly one viewport tall.
 */

export const BAND_START = 0.35;
export const BAND_END = 0.65;

export interface Pose {
  explode: number;
  yaw: number;
  pitch: number;
}

/** The settled position of step n is `y = n x H + 0.65 x H`. */
export function settledScrollY(step: number, viewportHeight: number): number {
  return viewportHeight * (step + BAND_END);
}

export function currentStepFromScroll(y: number, viewportHeight: number, stepCount: number): number {
  if (stepCount <= 0) return 0;
  const raw = Math.floor(y / viewportHeight);
  if (raw < 1) return 1;
  if (raw > stepCount) return stepCount;
  return raw;
}

function normaliseYaw(yaw: number): number {
  let value = yaw;
  while (value > 180) value -= 360;
  while (value < -180) value += 360;
  return value;
}

/**
 * The fraction through step n's band, 0 before it and 1 after it, so scrolling
 * back gives the same pose at the same place.
 */
export function bandFraction(y: number, viewportHeight: number, step: number): number {
  const from = viewportHeight * (step + BAND_START);
  const to = viewportHeight * (step + BAND_END);
  if (y <= from) return 0;
  if (y >= to) return 1;
  return (y - from) / (to - from);
}

export function poseFromScroll(
  y: number,
  viewportHeight: number,
  poses: readonly Pose[],
): Pose {
  if (poses.length === 0) return { explode: 0, yaw: 0, pitch: 0 };
  const step = currentStepFromScroll(y, viewportHeight, poses.length);
  const target = poses[step - 1] ?? poses[0];
  if (!target) return { explode: 0, yaw: 0, pitch: 0 };
  if (step === 1) return { ...target };
  const previous = poses[step - 2] ?? target;
  const t = bandFraction(y, viewportHeight, step);
  return {
    explode: previous.explode + (target.explode - previous.explode) * t,
    yaw: normaliseYaw(previous.yaw + (target.yaw - previous.yaw) * t),
    pitch: previous.pitch + (target.pitch - previous.pitch) * t,
  };
}

export const YAW_KEY_STEP = 15;
export const PITCH_KEY_STEP = 15;
export const PITCH_MIN = -60;
export const PITCH_MAX = 60;
export const ZOOM_IN_FACTOR = 1.25;
export const ZOOM_OUT_FACTOR = 0.8;
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3;
export const DRAG_PX_PER_DEGREE = 2;

export function clampPitch(pitch: number): number {
  return Math.min(PITCH_MAX, Math.max(PITCH_MIN, pitch));
}

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

export function wrapYaw(yaw: number): number {
  return normaliseYaw(yaw);
}

/** Published motion durations in milliseconds, fixed and not configured. */
export const MOTION = {
  stepChange: 320,
  editorApply: 250,
  callouts: 180,
  partsCost: 640,
  headerFigures: 800,
  commitDelay: 250,
  searchDelay: 250,
  noticeClear: 5000,
  modelRetry: 5000,
  liveDelay: 2000,
} as const;
