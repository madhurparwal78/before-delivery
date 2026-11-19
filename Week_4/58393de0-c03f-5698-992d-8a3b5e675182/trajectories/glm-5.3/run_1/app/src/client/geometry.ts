// Domain rules for the 3D Workshop and Block Lab geometry.
// Single source of truth for sizes, volumes, triangle counts, workplane math.
import type { ShapeObject, Primitive, GroupObject, Workplane, ShapeKind } from '../shared/scene.js';
import { SOLID_COLORS } from '../shared/scene.js';

export const SEGMENTS = 64;
export const RINGS = 32;
export const TRI_BOX = 12;
export const TRI_CYLINDER = 256;
export const TRI_SPHERE = 3968;
export const MAX_OBJECTS = 200;
export const SIZE_MIN = 0.1;
export const SIZE_MAX = 1000;

// Domain rule: new shapes are 20 × 20 × 20 mm, upright, resting on the
// workplane; the centre is the workplane origin plus normal × half extent
// along that normal (half of h for top/bottom, half of d for front/back,
// half of w for left/right).
export function newShapeCentre(workplane: Workplane, w: number, d: number, h: number): [number, number, number] {
  const [nx, ny, nz] = workplane.normal;
  const half = nz !== 0 ? h / 2 : ny !== 0 ? d / 2 : w / 2;
  const sign = nz < 0 || ny < 0 || nx < 0 ? -1 : 1;
  return [
    workplane.origin[0] + nx * half * sign,
    workplane.origin[1] + ny * half * sign,
    workplane.origin[2] + nz * half * sign,
  ];
}

export function nextColor(index: number): string {
  return SOLID_COLORS[index % SOLID_COLORS.length]!;
}

// Exact mesh volume of a primitive as rendered (matches the published volumes).
export function primitiveVolume(kind: ShapeKind, w: number, d: number, h: number): number {
  if (kind === 'box') return w * d * h;
  if (kind === 'cylinder') return Math.PI * (w / 2) ** 2 * h;
  return (4 / 3) * Math.PI * (w / 2) ** 3;
}

export function triangleCount(kind: ShapeKind): number {
  if (kind === 'box') return TRI_BOX;
  if (kind === 'cylinder') return TRI_CYLINDER;
  if (kind === 'sphere') return TRI_SPHERE;
  return 0;
}

export function bboxOfObject(obj: ShapeObject): { min: [number, number, number]; max: [number, number, number] } {
  const rad = Math.PI / 180;
  const a = obj.rotationZ * rad;
  const ca = Math.abs(Math.cos(a)), sa = Math.abs(Math.sin(a));
  const ew = obj.w * ca + obj.d * sa;
  const ed = obj.w * sa + obj.d * ca;
  return {
    min: [obj.x - ew / 2, obj.y - ed / 2, obj.z - obj.h / 2],
    max: [obj.x + ew / 2, obj.y + ed / 2, obj.z + obj.h / 2],
  };
}

export function selectionBBox(objects: ShapeObject[]): { min: [number, number, number]; max: [number, number, number] } | null {
  if (objects.length === 0) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const o of objects) {
    const bb = bboxOfObject(o);
    minX = Math.min(minX, bb.min[0]); maxX = Math.max(maxX, bb.max[0]);
    minY = Math.min(minY, bb.min[1]); maxY = Math.max(maxY, bb.max[1]);
    minZ = Math.min(minZ, bb.min[2]); maxZ = Math.max(maxZ, bb.max[2]);
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

// Workplane in-plane axes per the face table.
export function workplaneAxes(normal: [number, number, number]): { xDir: [number, number, number]; yDir: [number, number, number] } {
  const key = normal.join(',');
  switch (key) {
    case '0,0,1': return { xDir: [1, 0, 0], yDir: [0, 1, 0] };
    case '0,0,-1': return { xDir: [1, 0, 0], yDir: [0, -1, 0] };
    case '0,-1,0': return { xDir: [1, 0, 0], yDir: [0, 0, 1] };
    case '0,1,0': return { xDir: [-1, 0, 0], yDir: [0, 0, 1] };
    case '1,0,0': return { xDir: [0, 1, 0], yDir: [0, 0, 1] };
    case '-1,0,0': return { xDir: [0, -1, 0], yDir: [0, 0, 1] };
    default: return { xDir: [1, 0, 0], yDir: [0, 1, 0] };
  }
}

export const FACE_NAMES: Record<string, string> = {
  '0,0,1': 'top',
  '0,0,-1': 'bottom',
  '0,-1,0': 'front',
  '0,1,0': 'back',
  '1,0,0': 'right',
  '-1,0,0': 'left',
};

export const DEFAULT_WORKPLANE: Workplane = { origin: [0, 0, 0], normal: [0, 0, 1] };

// Snap a picked face's outward normal to the nearest world axis, ties in the
// stated order +Z, −Z, +X, −X, +Y, −Y.
export function snapNormal(n: [number, number, number]): [number, number, number] {
  const candidates: [number, number, number][] = [
    [0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0],
  ];
  let best = candidates[0]!;
  let bestDot = -Infinity;
  for (const c of candidates) {
    const dot = c[0] * n[0] + c[1] * n[1] + c[2] * n[2];
    if (dot > bestDot) { bestDot = dot; best = c; }
  }
  return best;
}

// Workplane origin for a picked face of an object: the centre of the side of
// the object's world bounding box that faces the snapped normal.
export function faceOrigin(obj: ShapeObject, normal: [number, number, number]): [number, number, number] {
  const bb = bboxOfObject(obj);
  const cx = (bb.min[0] + bb.max[0]) / 2;
  const cy = (bb.min[1] + bb.max[1]) / 2;
  const cz = (bb.min[2] + bb.max[2]) / 2;
  const [nx, ny, nz] = normal;
  return [
    nx !== 0 ? (nx > 0 ? bb.max[0] : bb.min[0]) : cx,
    ny !== 0 ? (ny > 0 ? bb.max[1] : bb.min[1]) : cy,
    nz !== 0 ? (nz > 0 ? bb.max[2] : bb.min[2]) : cz,
  ];
}

export function isPrimitive(o: ShapeObject): o is Primitive {
  return o.kind === 'box' || o.kind === 'cylinder' || o.kind === 'sphere';
}

export function isGroup(o: ShapeObject): o is GroupObject {
  return o.kind === 'group';
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function fmtNum(n: number): string {
  const r = round2(n);
  if (Number.isInteger(r)) return `${r}`;
  return `${r}`;
}
