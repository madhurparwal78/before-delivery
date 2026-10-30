// Orbit camera of the Board viewer contract: presets, limits, steps, the data-* forms and the address form of a pose.
export interface Pose {
  /** Degrees around the vertical axis, from positive z toward positive x. */
  yaw: number;
  /** Degrees of elevation above the target's horizon. */
  pitch: number;
  dist: number;
}
export type Preset = "front" | "side" | "top" | "three-quarter";

export const PRESETS: Record<Preset, Pose> = {
  front: { yaw: 90, pitch: 0, dist: 3.4 },
  side: { yaw: 0, pitch: 0, dist: 3.4 },
  top: { yaw: 0, pitch: 90, dist: 3.4 },
  "three-quarter": { yaw: 45, pitch: 25, dist: 3.4 },
};
export const PRESET_BUTTONS: [Preset, string][] = [["front", "Front view"], ["side", "Side view"], ["top", "Top view"], ["three-quarter", "Three-quarter view"]];
export const TARGET = { x: 0, y: -0.3, z: 0 };
export const FOV = 35;
const BASE_DISTANCE = 3.4;
const LIMITS = { pitchMin: -10, pitchMax: 90, distMin: 1.8, distMax: 6.0 };
export const STEPS = { yaw: 15, pitch: 10, dist: 0.4 };

export function wrap(yaw: number): number {
  return ((yaw % 360) + 360) % 360;
}

export function clamp(pose: Pose): Pose {
  return {
    yaw: wrap(pose.yaw),
    pitch: Math.min(LIMITS.pitchMax, Math.max(LIMITS.pitchMin, pose.pitch)),
    dist: Math.min(LIMITS.distMax, Math.max(LIMITS.distMin, pose.dist)),
  };
}

const rad = (deg: number) => (deg * Math.PI) / 180;

export function position(pose: Pose): { x: number; y: number; z: number } {
  const c = Math.cos(rad(pose.pitch));
  return { x: TARGET.x + pose.dist * c * Math.sin(rad(pose.yaw)), y: TARGET.y + pose.dist * Math.sin(rad(pose.pitch)), z: TARGET.z + pose.dist * c * Math.cos(rad(pose.yaw)) };
}

/** The camera's up direction along the orbit, defined straight overhead too. */
export function up(pose: Pose): { x: number; y: number; z: number } {
  const s = Math.sin(rad(pose.pitch));
  return { x: -s * Math.sin(rad(pose.yaw)), y: Math.cos(rad(pose.pitch)), z: -s * Math.cos(rad(pose.yaw)) };
}

const fixed = (value: number, digits: number) => {
  const text = value.toFixed(digits);
  return /^-0\.0*$/.test(text) ? text.slice(1) : text;
};

/** data-camera-yaw: one decimal, from 0 up to but not including 360. */
export function yawAttr(pose: Pose): string {
  const yaw = fixed(wrap(pose.yaw), 1);
  return yaw === "360.0" ? "0.0" : yaw;
}

export function pitchAttr(pose: Pose): string {
  return fixed(pose.pitch, 1);
}

/** data-camera-zoom: 3.4 divided by the distance, rounded half up to two decimals. */
export function zoomAttr(pose: Pose): string {
  return (Math.floor((BASE_DISTANCE / pose.dist) * 100 + 0.5) / 100).toFixed(2);
}

export function cameraAttr(pose: Pose): string {
  const p = position(pose);
  return `${fixed(p.x, 3)},${fixed(p.y, 3)},${fixed(p.z, 3)}`;
}

/** `orbit=<yaw>,<pitch>,<cm>` in whole degrees and centimetres, rounded half up. */
export function orbitParam(pose: Pose): string {
  const yaw = Math.round(wrap(pose.yaw)) % 360;
  return `${yaw},${Math.round(pose.pitch)},${Math.round(pose.dist * 100)}`;
}

export function parseView(query: URLSearchParams): { pose: Pose; preset: Preset | "custom" } {
  const view = query.get("view");
  if (view && view in PRESETS) return { pose: PRESETS[view as Preset], preset: view as Preset };
  const orbit = query.get("orbit")?.split(",").map(Number);
  if (orbit && orbit.length === 3 && orbit.every(Number.isFinite)) {
    return { pose: clamp({ yaw: orbit[0]!, pitch: orbit[1]!, dist: orbit[2]! / 100 }), preset: "custom" };
  }
  return { pose: PRESETS["three-quarter"], preset: "three-quarter" };
}

/** Shortest-way interpolation between two poses. */
export function lerp(a: Pose, b: Pose, t: number): Pose {
  const delta = ((b.yaw - a.yaw + 540) % 360) - 180;
  return { yaw: wrap(a.yaw + delta * t), pitch: a.pitch + (b.pitch - a.pitch) * t, dist: a.dist + (b.dist - a.dist) * t };
}
