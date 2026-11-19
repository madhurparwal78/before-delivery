import type { Bounds } from './glb';
import type { Part, Step } from './types';

export const FOV_DEGREES = 35;

/** Radius of the sphere the camera must frame: the model at rest plus the farthest any part is pulled apart, times the model scale. */
export function framingRadius(bounds: Bounds, parts: readonly Pick<Part, 'apart_mm'>[], steps: readonly Pick<Step, 'explode'>[], scale: number): number {
  const diagonal = Math.hypot(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]);
  const farthest = Math.max(0, ...parts.map((p) => Math.abs(p.apart_mm) / 1000)) * Math.max(0, ...steps.map((s) => s.explode));
  return ((diagonal / 2) + farthest) * scale;
}

/** Distance at which a sphere of this radius fills the view, with a margin. `zoom` 1 is the step's saved distance. */
export function cameraDistance(radius: number, zoom: number): number {
  return (radius / Math.sin((FOV_DEGREES * Math.PI) / 360)) / zoom;
}

/** Eye position relative to the target: yaw 0 looks from +Z, positive yaw moves toward +X, positive pitch lifts the eye. */
export function eyeOffset(yawDegrees: number, pitchDegrees: number, distance: number): [number, number, number] {
  const yaw = (yawDegrees * Math.PI) / 180;
  const pitch = (pitchDegrees * Math.PI) / 180;
  return [distance * Math.cos(pitch) * Math.sin(yaw), distance * Math.sin(pitch), distance * Math.cos(pitch) * Math.cos(yaw)];
}

/** Offset of a part at a step, in model space, in glTF units: apart distance (mm) x apart amount along the part's axis. */
export function partOffset(part: Pick<Part, 'axis' | 'apart_mm'>, explode: number): [number, number, number] {
  const metres = (part.apart_mm / 1000) * explode;
  return [part.axis === 'x' ? metres : 0, part.axis === 'y' ? metres : 0, part.axis === 'z' ? metres : 0];
}
