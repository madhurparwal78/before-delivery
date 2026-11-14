export type Vec3 = [number, number, number];

export interface Pose {
  position: Vec3;
  target: Vec3;
}

const RING_RADIUS = 9;
const EYE_HEIGHT = 1.6;

function direction(yawDegrees: number): Vec3 {
  const a = (yawDegrees * Math.PI) / 180;
  return [Math.sin(a), 0, -Math.cos(a)];
}

export function islandPosition(index: number): Vec3 {
  const d = direction((index - 1) * 45);
  return [d[0] * RING_RADIUS, 0, d[2] * RING_RADIUS];
}

export function ringPose(yaw: number): Pose {
  const d = direction(yaw);
  return { position: [0, EYE_HEIGHT, 0], target: [d[0] * RING_RADIUS, 1.1, d[2] * RING_RADIUS] };
}

export function abovePose(yaw: number): Pose {
  const d = direction(yaw);
  return { position: [-d[0] * 3, 26, -d[2] * 3], target: [d[0] * 2, 0, d[2] * 2] };
}

export function insidePose(index: number): Pose {
  const d = direction((index - 1) * 45);
  const island = islandPosition(index);
  return {
    position: [island[0] - d[0] * 6, 2.6, island[2] - d[2] * 6],
    target: [island[0], 2, island[2]],
  };
}

/** Symmetric ease: starts gently, is fastest at the midpoint and settles gently. */
export function ease(t: number): number {
  return (1 - Math.cos(Math.PI * Math.min(Math.max(t, 0), 1))) / 2;
}

function mix(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function mixPose(a: Pose, b: Pose, t: number): Pose {
  return { position: mix(a.position, b.position, t), target: mix(a.target, b.target, t) };
}
