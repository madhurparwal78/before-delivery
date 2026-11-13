import { CHAPTERS, type ChapterId } from "./catalogue.js";
import { ease } from "./motion.js";

/** The pure maths of the stage: how far each part group still has to travel, and where the camera stands. */

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** World-unit distance each group travels in from; the scene decides the direction. */
export const TRAVEL: Record<ChapterId, number> = { frame: 2.6, engine: 2.2, tank: 2.4, wheels: 2.8, exhaust: 2.4, seat: 2.2, cluster: 1.8 };

/** How far through its travel a group is: 0 before it starts, 1 from its seat point on. */
function travelled(group: ChapterId, progress: number): number {
  const c = CHAPTERS.find((x) => x.id === group) as (typeof CHAPTERS)[number];
  return clamp01((progress - c.start) / (c.seat - c.start));
}

/** Normalised distance left to travel for a group: 1 before it starts, easing out, exactly 0 from its seat point on. */
export const remaining = (group: ChapterId, progress: number): number => 1 - ease(travelled(group, progress));

/** How much of the graphite a group still hides in: 1 before it starts, 0 once it has mostly arrived. */
export const fogOf = (group: ChapterId, progress: number): number => 1 - ease(clamp01(travelled(group, progress) / 0.5));

export const seatOffsets = (progress: number): Record<ChapterId, number> =>
  Object.fromEntries(CHAPTERS.map((c) => [c.id, remaining(c.id, progress) * TRAVEL[c.id]])) as Record<ChapterId, number>;

export type Vec3 = readonly [number, number, number];
export type Pose = { position: Vec3; target: Vec3 };

/**
 * One continuous camera path: a pose at each chapter's jump point, eased between neighbours so the path is a pure
 * function of progress and scrolling back retraces it. The path stops at the cluster from 0.84 on.
 * Forward is +X, up is +Y and the rider's left is -Z, so the chain side is at negative z and the exhaust side positive.
 */
const WAYPOINTS: readonly { at: number; pose: Pose }[] = [
  { at: 0, pose: { position: [0.4, 1.5, 4.4], target: [0, 0.55, 0] } },
  { at: 0.07, pose: { position: [-0.6, 1.25, 3.7], target: [0, 0.55, 0] } },
  { at: 0.21, pose: { position: [0.3, 0.95, 2.7], target: [0.05, 0.5, 0] } },
  { at: 0.35, pose: { position: [0.2, 1.75, 2.1], target: [0.05, 0.95, 0] } },
  { at: 0.49, pose: { position: [0.1, 0.6, -3.1], target: [0, 0.4, 0] } },
  { at: 0.63, pose: { position: [-0.5, 0.75, 2.9], target: [-0.1, 0.45, 0] } },
  { at: 0.77, pose: { position: [-1.7, 1.55, 1.8], target: [-0.1, 0.8, 0] } },
  { at: 0.84, pose: { position: [-2.35, 1.6, -1.5], target: [0.28, 0.86, -0.12] } },
  { at: 1, pose: { position: [-2.35, 1.6, -1.5], target: [0.28, 0.86, -0.12] } },
];

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const mixVec = (a: Vec3, b: Vec3, t: number): [number, number, number] => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

export function cameraAt(progress: number): Pose {
  const p = clamp01(progress);
  let i = 0;
  while (i < WAYPOINTS.length - 2 && p > (WAYPOINTS[i + 1] as (typeof WAYPOINTS)[number]).at) i++;
  const a = WAYPOINTS[i] as (typeof WAYPOINTS)[number];
  const b = WAYPOINTS[i + 1] as (typeof WAYPOINTS)[number];
  const t = ease(clamp01((p - a.at) / (b.at - a.at)));
  return { position: mixVec(a.pose.position, b.pose.position, t), target: mixVec(a.pose.target, b.pose.target, t) };
}

export const blendPose = (a: Pose, b: Pose, t: number): Pose => ({ position: mixVec(a.position, b.position, t), target: mixVec(a.target, b.target, t) });
