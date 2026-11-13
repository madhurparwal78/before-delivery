import { CHAPTER_EDGES, type Chapter } from "../../../shared/domain.js";
import type { Vec3 } from "./types.js";

/** Vertical field of view of the scene camera, in degrees. */
export const FOV_DEG = 40;
/** Camera distance to the shelf plane at the final pose. */
export const SHELF_DISTANCE = 16;
/** Camera distance to the shelf plane in hold focus. */
export const FOCUS_DISTANCE = 5.5;

/** Progress at the middle of each chapter's range: the still pose of the discrete modes. */
export const STILL_PROGRESS: Record<Chapter, number> = {
  alley: 0.06,
  stove: 0.21,
  goose: 0.38,
  tree: 0.54,
  star: 0.67,
  grandmother: 0.79,
  shelf: 0.93,
};

const SHELF_START = CHAPTER_EDGES.shelf;
const SAMPLES_PER_SEGMENT = 500;
const LOOK_AHEAD = 7;

/** Hand-placed control points of the curved part of the path: the alley, down to its mouth. */
const CONTROLS: readonly Vec3[] = [
  { x: 0, y: 1.7, z: 52 },
  { x: 1.1, y: 1.78, z: 47.4 },
  { x: -0.9, y: 1.98, z: 42.6 },
  { x: 0.9, y: 2.28, z: 37.8 },
  { x: -0.7, y: 2.62, z: 33 },
  { x: 0.55, y: 2.98, z: 28.4 },
  { x: 0, y: 3.4, z: 24.2 },
  { x: 0, y: 3.4, z: 21 },
];

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smoothstep = (low: number, high: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - low) / (high - low)));
  return t * t * (3 - 2 * t);
};

const control = (index: number): Vec3 => {
  const last = CONTROLS.length - 1;
  if (index < 0) return sub(scale(CONTROLS[0] as Vec3, 2), CONTROLS[1] as Vec3);
  if (index > last) return sub(scale(CONTROLS[last] as Vec3, 2), CONTROLS[last - 1] as Vec3);
  return CONTROLS[index] as Vec3;
};

const catmullRom = (segment: number, t: number): Vec3 => {
  const p0 = control(segment - 1);
  const p1 = control(segment);
  const p2 = control(segment + 1);
  const p3 = control(segment + 2);
  const t2 = t * t;
  const t3 = t2 * t;
  const axis = (a: number, b: number, c: number, d: number): number =>
    0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
  return {
    x: axis(p0.x, p1.x, p2.x, p3.x),
    y: axis(p0.y, p1.y, p2.y, p3.y),
    z: axis(p0.z, p1.z, p2.z, p3.z),
  };
};

interface Table {
  points: Vec3[];
  lengths: number[];
}

const buildTable = (): Table => {
  const points: Vec3[] = [];
  const lengths: number[] = [];
  const segments = CONTROLS.length - 1;
  let total = 0;
  for (let segment = 0; segment < segments; segment += 1) {
    for (let i = segment === 0 ? 0 : 1; i <= SAMPLES_PER_SEGMENT; i += 1) {
      const point = catmullRom(segment, i / SAMPLES_PER_SEGMENT);
      const before = points[points.length - 1];
      if (before) total += Math.hypot(point.x - before.x, point.y - before.y, point.z - before.z);
      points.push(point);
      lengths.push(total);
    }
  }
  return { points, lengths };
};

const TABLE = buildTable();
const CURVED_LENGTH = TABLE.lengths[TABLE.lengths.length - 1] as number;
/** The last 14 % of progress is a straight dolly, so the curved part spans 86 % of the whole. */
const DOLLY_LENGTH = (CURVED_LENGTH * (1 - SHELF_START)) / SHELF_START;
/** Total length of the camera path in scene units. */
export const PATH_LENGTH = CURVED_LENGTH + DOLLY_LENGTH;
const MOUTH = CONTROLS[CONTROLS.length - 1] as Vec3;

/** The camera position at the end of the path. */
export const FINAL_POSITION: Vec3 = { x: MOUTH.x, y: MOUTH.y, z: MOUTH.z - DOLLY_LENGTH };
/** The z of the plane carrying the faces of the shelf boxes. */
export const SHELF_PLANE_Z = FINAL_POSITION.z - SHELF_DISTANCE;
/** The z at which the alley opens into the court before the shelf wall. */
export const MOUTH_Z = MOUTH.z;
export const START_Z = (CONTROLS[0] as Vec3).z;

/** Position at arc length `s` along the path; beyond the end the dolly line simply continues. */
const positionAt = (s: number): Vec3 => {
  if (s >= CURVED_LENGTH) return { x: MOUTH.x, y: MOUTH.y, z: MOUTH.z - (s - CURVED_LENGTH) };
  const { points, lengths } = TABLE;
  const target = Math.max(0, s);
  let low = 0;
  let high = lengths.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if ((lengths[mid] as number) <= target) low = mid;
    else high = mid;
  }
  const from = points[low] as Vec3;
  const to = points[high] as Vec3;
  const span = (lengths[high] as number) - (lengths[low] as number);
  const t = span > 0 ? (target - (lengths[low] as number)) / span : 0;
  return add(from, scale(sub(to, from), t));
};

export const clampProgress = (progress: number): number => Math.min(1, Math.max(0, progress));

/** The camera position for a scroll progress: a pure function of progress. */
export const pathPoint = (progress: number): Vec3 => positionAt(clampProgress(progress) * PATH_LENGTH);

/** A unit vector from yaw (right of -Z, radians) and pitch (up, radians). */
const directionOf = (yaw: number, pitch: number): Vec3 => ({
  x: Math.sin(yaw) * Math.cos(pitch),
  y: Math.sin(pitch),
  z: -Math.cos(yaw) * Math.cos(pitch),
});

/** The camera's viewing direction; exactly -Z from the start of the shelf range onward. */
export const pathForward = (progress: number): Vec3 => {
  const p = clampProgress(progress);
  const blend = p >= SHELF_START ? 1 : smoothstep(0.46, SHELF_START, p);
  if (blend === 1) return { x: 0, y: 0, z: -1 };
  const s = p * PATH_LENGTH;
  const here = positionAt(s);
  const ahead = positionAt(s + LOOK_AHEAD);
  const yaw = Math.atan2(ahead.x - here.x, here.z - ahead.z) * (1 - blend);
  const pitch = lerp(-0.07, -0.16, smoothstep(0, 0.7, p)) * (1 - blend);
  return directionOf(yaw, pitch);
};

export const stillPoint = (chapter: Chapter): Vec3 =>
  pathPoint(chapter === "shelf" ? 1 : STILL_PROGRESS[chapter]);
