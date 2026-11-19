import type { Camera, Phase } from './types';

export interface StepPose { explode: number; yaw: number; pitch: number }

export const BAND_START = 0.35;
export const BAND_END = 0.65;

interface FieldColours { field: string; text: string }

export const fieldColours: Record<Phase | 'closing', FieldColours> = {
  open_up: { field: '#C9301F', text: '#FFFFFF' },
  take_out: { field: '#EFE6D4', text: '#1F150C' },
  fit_new: { field: '#E3A82B', text: '#1F150C' },
  close_up: { field: '#3D5A7C', text: '#FFFFFF' },
  test_it: { field: '#5A1523', text: '#FFFFFF' },
  closing: { field: '#C9301F', text: '#FFFFFF' },
};

/** The step that is current at scroll position y (1-based); the header section and closing section keep step 1 and the last. */
export function stepAt(y: number, height: number, total: number): number {
  return Math.min(total, Math.max(1, Math.floor(y / height)));
}

export function settledY(step: number, height: number): number {
  return (step + BAND_END) * height;
}

/** Pose at scroll position y: moves linearly from step n-1 to step n through the band of step n's section. */
export function poseAt(y: number, height: number, poses: readonly StepPose[]): StepPose {
  const total = poses.length;
  const step = stepAt(y, height, total);
  const current = poses[step - 1];
  if (!current) return { explode: 0, yaw: 0, pitch: 0 };
  const previous = step > 1 ? poses[step - 2] ?? current : current;
  const into = y / height - step;
  const t = y >= (total + 1) * height ? 1 : Math.min(1, Math.max(0, (into - BAND_START) / (BAND_END - BAND_START)));
  return {
    explode: previous.explode + (current.explode - previous.explode) * t,
    yaw: previous.yaw + (current.yaw - previous.yaw) * t,
    pitch: previous.pitch + (current.pitch - previous.pitch) * t,
  };
}

/** Saved camera distance factor interpolated through the same band. */
export function zoomAt(y: number, height: number, cameras: readonly Camera[]): number {
  const total = cameras.length;
  const step = stepAt(y, height, total);
  const current = cameras[step - 1];
  if (!current) return 1;
  const previous = step > 1 ? cameras[step - 2] ?? current : current;
  const into = y / height - step;
  const t = y >= (total + 1) * height ? 1 : Math.min(1, Math.max(0, (into - BAND_START) / (BAND_END - BAND_START)));
  return previous.zoom + (current.zoom - previous.zoom) * t;
}

/** The step whose focus parts and callouts show at y: step n only once its pose has arrived, otherwise step n-1. */
export function focusStepAt(y: number, height: number, total: number): number {
  const step = stepAt(y, height, total);
  return step > 1 && y + 1 < settledY(step, height) ? step - 1 : step;
}

/** Phase field behind document position docY: the field of step n spans [settled(n), settled(n+1)); the first spans from 0. */
export function fieldIndexAt(docY: number, height: number, total: number): number {
  for (let step = total; step >= 2; step--) if (docY >= settledY(step, height)) return step;
  return 1;
}
