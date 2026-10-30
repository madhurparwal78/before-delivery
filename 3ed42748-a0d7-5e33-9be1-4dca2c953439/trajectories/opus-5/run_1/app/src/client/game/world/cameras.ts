import { add, cross, dot, length, normalise, scale, sub, type Vec3 } from './glmath.js';

export type CameraKind = 'intro' | 'over-shoulder' | 'orbit' | 'photo';

export interface CameraPose {
  eye: Vec3;
  target: Vec3;
  up: Vec3;
  fovDeg: number;
}

export const FOLLOW_FOV_DEG = 55;
export const INTRO_FOV_DEG = 40;
export const INTRO_START_RADIUS_M = 240;
export const PHOTO_START_FOV_DEG = 50;
export const PHOTO_DISTANCE_M = 8;
export const PHOTO_ELEVATION_DEG = 20;
export const FOLLOW_BACK_M = 7;
export const FOLLOW_UP_M = 3.5;
export const FOLLOW_AHEAD_M = 2;
export const FOLLOW_LOOK_UP_M = 1;
export const MIN_CAMERA_CLEARANCE_M = 1.5;

export interface Stance {
  unit: Vec3;
  headingDeg: number;
  radiusM: number;
}

const toRad = Math.PI / 180;

export function tangentBasis(unit: Vec3): { north: Vec3; east: Vec3 } {
  const up = normalise(unit);
  const polar: Vec3 = [0, 1, 0];
  let east = cross(polar, up);
  if (length(east) < 1e-4) east = [1, 0, 0];
  east = normalise(east);
  return { north: normalise(cross(up, east)), east };
}

export function bearingDirection(unit: Vec3, bearingDeg: number): Vec3 {
  const { north, east } = tangentBasis(unit);
  const angle = bearingDeg * toRad;
  return normalise(add(scale(north, Math.cos(angle)), scale(east, Math.sin(angle))));
}

/** Walks along the surface from a unit position, returning the new unit position. */
export function stepAlong(unit: Vec3, direction: Vec3, metres: number, radiusM: number): Vec3 {
  const angle = metres / radiusM;
  return normalise(add(scale(normalise(unit), Math.cos(angle)), scale(direction, Math.sin(angle))));
}

/** The resting over-the-shoulder pose. */
export function followPose(stance: Stance): CameraPose {
  const up = normalise(stance.unit);
  const heading = bearingDirection(up, stance.headingDeg);
  const back = stepAlong(up, heading, -FOLLOW_BACK_M, stance.radiusM);
  const ahead = stepAlong(up, heading, FOLLOW_AHEAD_M, stance.radiusM);
  return {
    eye: add(scale(back, stance.radiusM), scale(up, FOLLOW_UP_M)),
    target: scale(ahead, stance.radiusM + FOLLOW_LOOK_UP_M),
    up,
    fovDeg: FOLLOW_FOV_DEG,
  };
}

/** The whole planet hanging in the sky, on the line through the courier. */
export function introStartPose(stance: Stance): CameraPose {
  const up = normalise(stance.unit);
  return {
    eye: scale(up, INTRO_START_RADIUS_M),
    target: [0, 0, 0],
    up: tangentBasis(up).north,
    fovDeg: INTRO_FOV_DEG,
  };
}

export interface Viewport {
  width: number;
  height: number;
}

/**
 * The orbit that frames both the courier and the door: on the outward line through the route's
 * midpoint, far enough out that both points sit well inside the viewport.
 */
export function orbitPose(
  from: Vec3,
  door: Vec3,
  radiusM: number,
  viewport: Viewport,
): CameraPose {
  const a = normalise(from);
  const b = normalise(door);
  const midpoint = normalise(add(a, b));
  const arcAngle = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
  const halfArc = Math.min(arcAngle / 2, 75 * toRad);
  const aspect = viewport.width / Math.max(1, viewport.height);
  const verticalHalf = (FOLLOW_FOV_DEG / 2) * toRad;
  const horizontalHalf = Math.atan(Math.tan(verticalHalf) * aspect);
  const landscape = viewport.width >= viewport.height;
  const roomy = landscape ? horizontalHalf : verticalHalf;
  const wanted = Math.max(0.08, 0.75 * roomy);
  const needed = radiusM * Math.cos(halfArc) + (radiusM * Math.sin(halfArc)) / Math.tan(wanted);
  const distance = Math.max(radiusM * 2.2, Math.min(radiusM * 4, needed));

  let along = sub(b, a);
  along = sub(along, scale(midpoint, dot(along, midpoint)));
  if (length(along) < 1e-4) along = tangentBasis(midpoint).north;
  along = normalise(along);
  const forward = scale(midpoint, -1);
  const up = landscape ? normalise(cross(along, forward)) : along;
  return { eye: scale(midpoint, distance), target: [0, 0, 0], up, fovDeg: FOLLOW_FOV_DEG };
}

/** The photo camera, orbiting the courier at a fixed distance and elevation. */
export function photoPose(stance: Stance, yawDeg: number, fovDeg: number): CameraPose {
  const up = normalise(stance.unit);
  const feet = scale(up, stance.radiusM);
  const horizontal = bearingDirection(up, stance.headingDeg + 180 + yawDeg);
  const elevation = PHOTO_ELEVATION_DEG * toRad;
  const offset = add(
    scale(horizontal, PHOTO_DISTANCE_M * Math.cos(elevation)),
    scale(up, PHOTO_DISTANCE_M * Math.sin(elevation)),
  );
  return {
    eye: add(feet, offset),
    target: add(feet, scale(up, 1)),
    up,
    fovDeg,
  };
}

export function mixPose(from: CameraPose, to: CameraPose, amount: number): CameraPose {
  const blend = (a: Vec3, b: Vec3): Vec3 => [
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  ];
  return {
    eye: blend(from.eye, to.eye),
    target: blend(from.target, to.target),
    up: normalise(blend(from.up, to.up)),
    fovDeg: from.fovDeg + (to.fovDeg - from.fovDeg) * amount,
  };
}

export interface Obstacle {
  unit: Vec3;
  footprintM: number;
  heightM: number;
}

/** The camera's height above whatever lies below it, homes included. */
export function altitudeAbove(eye: Vec3, radiusM: number, obstacles: Obstacle[]): number {
  const ground = normalise(eye);
  let surface = radiusM;
  for (const obstacle of obstacles) {
    const separation = Math.acos(Math.max(-1, Math.min(1, dot(ground, normalise(obstacle.unit)))));
    if (separation * radiusM <= obstacle.footprintM) {
      surface = Math.max(surface, radiusM + obstacle.heightM);
    }
  }
  return length(eye) - surface;
}

/** Pulls a pose in along its own line until it clears the surface below it. */
export function clearPose(pose: CameraPose, radiusM: number, obstacles: Obstacle[]): CameraPose {
  if (altitudeAbove(pose.eye, radiusM, obstacles) >= MIN_CAMERA_CLEARANCE_M) return pose;
  const ground = normalise(pose.eye);
  let surface = radiusM;
  for (const obstacle of obstacles) {
    const separation = Math.acos(Math.max(-1, Math.min(1, dot(ground, normalise(obstacle.unit)))));
    if (separation * radiusM <= obstacle.footprintM) {
      surface = Math.max(surface, radiusM + obstacle.heightM);
    }
  }
  return { ...pose, eye: scale(ground, surface + MIN_CAMERA_CLEARANCE_M) };
}
