import { worldOf, type Pose, type RoomDims } from './roomView';

const EYE_MM = 1600;
const WALK_FOV = 70;
const OVERVIEW_FOV = 45;
const START_INSIDE_MM = 800;
export const DOLLY_MS = 600;

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** The editing camera: orbiting the room's centre at a yaw, pitch and zoom. */
export function overviewPose(dims: RoomDims, yawDeg: number, pitchDeg: number, zoom = 1, aspect = 1.6): Pose {
  const w = dims.widthMm / 1000;
  const d = dims.depthMm / 1000;
  const h = dims.heightMm / 1000;
  const target: [number, number, number] = [w / 2, h * 0.2, -d / 2];
  const radius = Math.hypot(w, d, h) / 2;
  const vertical = rad(OVERVIEW_FOV / 2);
  const horizontal = Math.atan(Math.tan(vertical) * aspect);
  const distance = (radius / Math.sin(Math.min(vertical, horizontal))) * 1.15 * zoom;
  const yaw = rad(yawDeg);
  const pitch = rad(pitchDeg);
  return {
    position: [target[0] + distance * Math.sin(yaw) * Math.cos(pitch), target[1] + distance * Math.sin(pitch), target[2] + distance * Math.cos(yaw) * Math.cos(pitch)],
    target,
    fov: OVERVIEW_FOV,
  };
}

/** Standing at a floor point at eye height, looking along a heading (0 = into the room from the front wall, clockwise from above). */
export function eyePose(xMm: number, zMm: number, headingDeg: number, pitchDeg = 0): Pose {
  const position = worldOf(xMm, EYE_MM, zMm);
  const heading = rad(headingDeg);
  const pitch = rad(pitchDeg);
  return {
    position: [position.x, position.y, position.z],
    target: [position.x + Math.sin(heading) * Math.cos(pitch), position.y + Math.sin(pitch), position.z - Math.cos(heading) * Math.cos(pitch)],
    fov: WALK_FOV,
  };
}

export interface Stance {
  xMm: number;
  zMm: number;
  headingDeg: number;
}

/** The player-height start: 0.8 m inside the entry door, facing into the room; mid front wall when the room has no entry door. */
interface DoorLike {
  kind: string;
  xMm: number;
  zMm: number;
  entry?: boolean;
}

export function startStance(dims: RoomDims, placements: readonly DoorLike[]): Stance {
  const door = placements.find((p) => p.kind === 'door' && p.entry);
  const at = door ?? { xMm: Math.round(dims.widthMm / 2), zMm: 0 };
  const walls = [
    { gap: at.zMm, inward: [0, 1] },
    { gap: dims.depthMm - at.zMm, inward: [0, -1] },
    { gap: at.xMm, inward: [1, 0] },
    { gap: dims.widthMm - at.xMm, inward: [-1, 0] },
  ] as const;
  const nearest = walls.reduce((best, wall) => (wall.gap < best.gap ? wall : best));
  const [ix, iz] = nearest.inward;
  const clamp = (value: number, max: number): number => Math.max(0, Math.min(max, value));
  return {
    xMm: clamp(at.xMm + ix * START_INSIDE_MM, dims.widthMm),
    zMm: clamp(at.zMm + iz * START_INSIDE_MM, dims.depthMm),
    headingDeg: (Math.round((Math.atan2(ix, iz) * 180) / Math.PI) + 360) % 360,
  };
}

const ease = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

export function blendPose(from: Pose, to: Pose, t: number): Pose {
  const e = ease(t);
  return {
    position: [mix(from.position[0], to.position[0], e), mix(from.position[1], to.position[1], e), mix(from.position[2], to.position[2], e)],
    target: [mix(from.target[0], to.target[0], e), mix(from.target[1], to.target[1], e), mix(from.target[2], to.target[2], e)],
    fov: mix(from.fov, to.fov, e),
  };
}

/** Runs a camera move over `ms` of page time, frame by frame; returns a cancel function. */
export function dolly(from: Pose, to: Pose, ms: number, onFrame: (pose: Pose) => void, onDone: () => void): () => void {
  let frame = 0;
  let begin = 0;
  const step = (now: number): void => {
    begin ||= now;
    const t = Math.min(1, (now - begin) / ms);
    onFrame(blendPose(from, to, t));
    if (t < 1) frame = requestAnimationFrame(step);
    else onDone();
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}
