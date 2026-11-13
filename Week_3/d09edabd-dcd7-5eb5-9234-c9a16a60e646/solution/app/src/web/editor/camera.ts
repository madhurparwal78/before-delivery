import { editor } from './state';
import type { Arrow } from './placements';

const PITCH_MIN = 5;
const PITCH_MAX = 80;
const CAMERA_STEP = 15;

export const roundHalfUp = (value: number): number => Math.floor(value + 0.5);

export const wrapYaw = (yaw: number): number => ((yaw % 360) + 360) % 360;

export const clampPitch = (pitch: number): number => Math.max(PITCH_MIN, Math.min(PITCH_MAX, pitch));

/** Arrow keys with nothing selected and focus on the stage: yaw by 15 degrees, pitch by 15 degrees (stopping at 5 and 80). */
export function turnCamera(arrow: Arrow): void {
  editor.set((s) => {
    const yaw = roundHalfUp(s.cam.yaw);
    const pitch = roundHalfUp(s.cam.pitch);
    if (arrow === 'ArrowRight') return { cam: { ...s.cam, yaw: wrapYaw(yaw + CAMERA_STEP) } };
    if (arrow === 'ArrowLeft') return { cam: { ...s.cam, yaw: wrapYaw(yaw - CAMERA_STEP) } };
    return { cam: { ...s.cam, pitch: clampPitch(pitch + (arrow === 'ArrowUp' ? CAMERA_STEP : -CAMERA_STEP)) } };
  });
}

/** A drag or a pinch moved the editing camera: values stay exact, the stage shows them rounded. */
export function setOrbit(yaw: number, pitch: number, zoom?: number): void {
  editor.set((s) => ({ cam: { ...s.cam, yaw: wrapYaw(yaw), pitch: clampPitch(pitch), zoom: zoom ?? s.cam.zoom } }));
}

export function setCameraLabel(label: 'Overview' | 'Walking in' | 'Player height'): void {
  editor.set((s) => ({ cam: { ...s.cam, label } }));
}
